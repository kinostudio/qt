import {SigningError} from './signing-store.js';

export const BROWSER_BUDGET={dailyMs:480000,reserveMs:120000,runMs:45000,cooldownMs:25000,idleMs:10000};
export const BROWSER_BUDGET_SQL={
  reserve:`INSERT INTO quote_browser_budget(id,day,used_ms,next_start_at,lease_id,lease_until)
    SELECT 1,?1,120000,?2+25000,?3,?2+120000
    WHERE NOT EXISTS(SELECT 1 FROM quote_browser_budget WHERE next_start_at>?2 OR lease_until>?2)
    ON CONFLICT(id) DO UPDATE SET day=excluded.day,
      used_ms=CASE WHEN day=excluded.day THEN used_ms+120000 ELSE 120000 END,
      next_start_at=excluded.next_start_at,lease_id=excluded.lease_id,lease_until=excluded.lease_until
    WHERE (day!=excluded.day OR used_ms+120000<=480000) AND next_start_at<=?2 AND lease_until<=?2 RETURNING *`,
  release:`UPDATE quote_browser_budget SET used_ms=MAX(0,used_ms-120000+?3),lease_id=NULL,lease_until=0
    WHERE id=1 AND day=?1 AND lease_id=?2`
};

export async function reserveBrowserBudget(env,now=Date.now()) {
  const day=new Date(now).toISOString().slice(0,10),id=crypto.randomUUID();
  let row,current;
  try {
    row=await env.DB.prepare(BROWSER_BUDGET_SQL.reserve).bind(day,now,id).first();
    if(!row)current=await env.DB.prepare('SELECT * FROM quote_browser_budget WHERE id=1').first();
  } catch {throw new SigningError('瀏覽器額度保護尚未就緒，請先使用列印另存 PDF。',503);}
  if(!row) {
    if(current?.day===day && current.used_ms+BROWSER_BUDGET.reserveMs>BROWSER_BUDGET.dailyMs)throw new SigningError('今日 PDF／簽署瀏覽器預算已用完，請明日再試；一般報價仍可使用列印另存 PDF。',429);
    const retryAfter=Math.max(1,Math.ceil((Math.max(current?.next_start_at||0,current?.lease_until||0)-now)/1000));
    throw new SigningError(current?.lease_until>now
      ? `另一個產檔工作尚未釋放，請約 ${retryAfter} 秒後重試；目前內容已保留。`
      : `產檔啟動間隔尚未結束，請等待 ${retryAfter} 秒後重試；目前內容已保留。`,429,retryAfter);
  }
  return {day,id,startedAt:now};
}

async function launchDefault(binding,options) {
  const {default:puppeteer}=await import('@cloudflare/puppeteer');
  return puppeteer.launch(binding,options);
}
function timeout(promise,ms,message) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new SigningError(message,503)),ms);})]).finally(()=>clearTimeout(timer));
}

// Request-local only. Cached PDFs and completed retries never acquire a browser.
export function createBudgetBrowserSession(env,{launch=launchDefault,clock=Date.now}={}) {
  let promise,active,closePromise,reservation,watchdog,expired=false,finished=false;
  const closeActive=()=>active?(closePromise||=Promise.resolve().then(()=>active.close())):Promise.resolve();
  async function acquire() {
    if(!env.PDF_BROWSER)throw new SigningError('瀏覽器產檔服務尚未啟用',503);
    reservation=await reserveBrowserBudget(env,clock());
    if(finished)throw new SigningError('產檔已結束，請重新操作。',503);
    watchdog=setTimeout(()=>{expired=true;void closeActive().catch(()=>{});},BROWSER_BUDGET.runMs);
    const opening=Promise.resolve().then(()=>launch(env.PDF_BROWSER,{keep_alive:BROWSER_BUDGET.idleMs}));
    void opening.then(browser=>{active=browser;if(expired||finished)void closeActive().catch(()=>{});},()=>{});
    return timeout(opening,BROWSER_BUDGET.runMs,'瀏覽器啟動逾時，請稍後重試。');
  }
  return {
    async browser() {
      if(expired||finished)throw new SigningError('產檔已逾時或結束，請重試原簽署內容。',503);
      const browser=await(promise||=acquire());
      if(expired||finished)throw new SigningError('產檔已逾時，請重試原簽署內容。',503);
      return browser;
    },
    async close() {
      if(finished)return;finished=true;clearTimeout(watchdog);
      if(!reservation||!active)return;
      try {await timeout(closeActive(),5000,'瀏覽器關閉未確認');}
      catch {return;}
      // Only confirmed closes refund unused reservation; retain 15s safety overhead.
      const charged=Math.min(BROWSER_BUDGET.reserveMs,Math.max(1000,clock()-reservation.startedAt+15000));
      try{await env.DB.prepare(BROWSER_BUDGET_SQL.release).bind(reservation.day,reservation.id,charged).run();}catch{/* Keep the full reservation if settlement is uncertain. */}
    }
  };
}
