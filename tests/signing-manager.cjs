const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

(async()=>{
  const {validateSigningCreate}=await import('../cloud-sync/src/signing-validation.js');
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    const page=await context.newPage(),calls=[],errors=[],records=[];let captured,preparedSnapshot,enabled=true,failCreate=false,throttleCreate=false;
    const preparedId='22222222-2222-4222-8222-222222222222';
    const signed={id:'11111111-1111-4111-8111-111111111111',quotationId:'TEST-SIGNED',status:'signed',createdAt:Date.now(),expiresAt:Date.now()+86400000,revokedAt:null};
    records.push(signed);
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{sessionStorage.setItem('kino_quotation_cloud_auth_token','mock-owner-session');sessionStorage.setItem('kino_quotation_cloud_auth_user',JSON.stringify({email:'owner@example.test'}));localStorage.setItem('kino_quotation_mobile_toolbar_expanded','true');});
    await context.route('**/*',async route=>{
      const r=route.request(),url=new URL(r.url());
      if(url.origin==='https://qt.test') {
        const root=path.resolve(__dirname,'..'),file=path.resolve(root,'.'+url.pathname);assert.ok(file.startsWith(root+path.sep));
        return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});
      }
      if(url.hostname.includes('kino-quotation-data-api')) {
        const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'};
        if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});
        calls.push(r.method()+' '+url.pathname);let body;
        if(url.pathname==='/api/config')body={signingEnabled:enabled};
        else {
          assert.equal(r.headers().authorization,'Bearer mock-owner-session');
          if(url.pathname==='/api/auth/me')body={user:{email:'owner@example.test'}};
          else if(url.pathname==='/api/stamps')body={assets:[]};
          else if(url.pathname==='/api/sync'&&r.method()==='GET')body={projects:[],templates:[],categories:[],clauses:[]};
          else if(url.pathname==='/api/signing/prepare') {
            const payload=JSON.parse(r.postData());validateSigningCreate({confirmed:true,...payload});preparedSnapshot=payload.snapshot;body={preparedId};
          } else if(url.pathname==='/api/signing'&&r.method()==='POST') {
            captured=JSON.parse(r.postData());validateSigningCreate(captured);
            if(throttleCreate)return route.fulfill({status:429,json:{error:'啟動間隔尚未結束，請等待 2 秒後重試。',retryAfter:2},headers});
            assert.equal(captured.preparedId,preparedId);assert.equal(captured.snapshot,undefined);
            const row={id:crypto.randomUUID(),quotationId:preparedSnapshot.quotation.header.quotationId,status:'pending',createdAt:Date.now(),expiresAt:Date.now()+captured.lifetimeDays*86400000,revokedAt:null};records.unshift(row);body={...row,url:'https://quote.kinostudio.tw/s/'+'A'.repeat(43)};
            if(failCreate)return route.abort('failed');
          } else if(url.pathname==='/api/signing')body={items:records,nextOffset:null};
          else if(url.pathname.endsWith('/pdf'))return route.fulfill({body:'%PDF-1.7\nMOCK-ARCHIVE\n%%EOF',contentType:'application/pdf',headers});
          else if(url.pathname.startsWith('/api/signing/')) {
            const row=records.find(row=>row.id===url.pathname.split('/').pop());assert.ok(row);
            if(r.method()==='DELETE'){row.revokedAt=Date.now();body={ok:true};}
            else body={...row,url:'https://quote.kinostudio.tw/s/'+'A'.repeat(43)};
          } else throw Error('Unexpected cloud request '+r.method()+' '+url.pathname);
        }
        return route.fulfill({json:body,headers});
      }
      if(url.hostname==='unpkg.com'||url.hostname==='cdn.tailwindcss.com')return route.continue();
      return route.abort();
    });
    await page.goto('https://qt.test/index.html',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'客戶簽署',exact:true}).waitFor({timeout:45000});await page.getByRole('button',{name:'客戶簽署',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'客戶簽署管理'});await dialog.getByText('TEST-SIGNED',{exact:true}).waitFor();
    const count=()=>calls.filter(c=>c==='POST /api/signing').length;
    assert.equal(count(),0);await dialog.getByRole('button',{name:'準備固定版本並預覽'}).click();
    await dialog.getByRole('status').filter({hasText:'固定版本已備妥'}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'建立客戶簽署連結'}).isEnabled(),false);assert.equal(count(),0);
    await dialog.getByRole('checkbox').check();await dialog.locator('[data-area=days]').fill('7');await dialog.getByRole('button',{name:'建立客戶簽署連結'}).click();
    await dialog.getByRole('status').filter({hasText:'已建立不可隨草稿變動'}).waitFor();assert.equal(count(),1);assert.equal(captured.lifetimeDays,7);
    assert.equal(await dialog.getByLabel('客戶專用連結',{exact:true}).inputValue(),'https://quote.kinostudio.tw/s/'+'A'.repeat(43));
    await dialog.getByRole('button',{name:'複製連結',exact:true}).click();await dialog.getByRole('status').filter({hasText:'客戶連結已複製'}).waitFor();
    const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'下載已簽 PDF',exact:true}).click();assert.equal((await download).suggestedFilename(),'TEST-SIGNED.pdf');
    const first=dialog.locator('article').first();await first.getByRole('button',{name:'撤銷客戶連結',exact:true}).click();assert.equal(calls.filter(c=>c.startsWith('DELETE')).length,0);
    await first.getByRole('button',{name:'確認撤銷（保留已簽檔）',exact:true}).click();await dialog.getByRole('status').filter({hasText:'客戶連結已撤銷'}).waitFor();assert.ok(records[0].revokedAt);
    await page.screenshot({path:'tmp/signing-manager-mobile.png'});
    await dialog.getByRole('button',{name:'關閉簽署管理',exact:true}).click();
    await page.setViewportSize({width:1280,height:900});await page.getByRole('button',{name:'客戶簽署',exact:true}).click();await page.getByText('TEST-SIGNED',{exact:true}).waitFor();
    await page.screenshot({path:'tmp/signing-manager-desktop.png'});
    const desktopDialog=page.getByRole('dialog',{name:'客戶簽署管理'});
    await desktopDialog.getByRole('button',{name:'準備固定版本並預覽'}).click();await desktopDialog.getByRole('status').filter({hasText:'固定版本已備妥'}).waitFor();
    throttleCreate=true;await desktopDialog.getByRole('checkbox').check();await desktopDialog.getByRole('button',{name:'建立客戶簽署連結'}).click();
    await desktopDialog.getByRole('status').filter({hasText:'啟動間隔尚未結束'}).waitFor();assert.equal(await desktopDialog.getByRole('button',{name:/建立客戶簽署連結/}).isDisabled(),true);assert.equal(records.length,2);
    await desktopDialog.getByRole('checkbox').uncheck();await desktopDialog.getByRole('checkbox').check();assert.equal(await desktopDialog.getByRole('button',{name:/建立客戶簽署連結/}).isDisabled(),true);
    await desktopDialog.getByRole('status').filter({hasText:'等待已結束'}).waitFor();assert.equal(await desktopDialog.getByRole('button',{name:'建立客戶簽署連結',exact:true}).isEnabled(),true);
    throttleCreate=false;failCreate=true;await desktopDialog.getByRole('button',{name:'建立客戶簽署連結'}).click();
    await desktopDialog.getByRole('status').filter({hasText:'避免重複建立'}).waitFor();assert.equal(count(),3);assert.equal(records.length,3);assert.equal(await desktopDialog.getByRole('button',{name:'建立客戶簽署連結'}).isVisible(),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
    assert.ok(!calls.includes('POST /api/sync'),'Signing manager cannot write original cloud data');
    assert.ok(!calls.includes('POST /api/pdf'),'Link creation uses the prepared PDF, not a separate general export');
    enabled=false;await page.reload();await page.getByRole('button',{name:'快速報價',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'客戶簽署',exact:true}).count(),0);
    console.log('PASS isolated editor manager: gated toolbar, fixed capture, explicit create consent, copy, archive download, two-step revoke, mobile/desktop, no sync writes');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
