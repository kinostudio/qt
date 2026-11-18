// Anonymous production smoke: application writes are blocked before reaching the network.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  for(const width of [390,1366]){
   const context=await browser.newContext({viewport:{width,height:900}}),writes=[],errors=[];
   await context.route('https://kino-quotation-data-api.film-kinostudio.workers.dev/**',route=>{
    if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){writes.push(route.request().url());return route.abort();}
    return route.continue();
   });
   const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
   await page.goto('https://qt.kinostudio.tw/',{waitUntil:'domcontentloaded'});
   const expand=page.getByRole('button',{name:'展開導覽列',exact:true}).filter({visible:true});
   await page.getByRole('button',{name:/展開導覽列|收合導覽列/}).filter({visible:true}).waitFor({timeout:45000});
   if(await expand.count())await expand.click();
   await page.getByRole('button',{name:'雲端與帳號',exact:true}).filter({visible:true}).click();
   const panel=page.getByRole('dialog',{name:'雲端與帳號設定',exact:true});await panel.waitFor();
   await panel.getByRole('button',{name:'Google 登入',exact:true}).waitFor();
   await panel.getByRole('button',{name:'連接 OneDrive',exact:true}).waitFor();
   const box=await panel.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
   await page.screenshot({path:`tmp/cloud-panel-live-${width}.png`});
   await page.keyboard.press('Escape');assert.equal(await panel.count(),0);
   assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
   console.log(`PASS LIVE ${width}px anonymous cloud panel, no application writes, no credentials used`);
   await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
