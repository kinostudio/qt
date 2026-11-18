const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [], uploads = [], calls = [], folderCreates = [];
  const pdfOutputs=[];
  let activeUploads=0, maxActive=0;
  page.on('pageerror', e => {errors.push(e.message); console.error(e.message);});
  if (process.env.TEST_PDF==='1') page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  const clause = {id:'test-clause',categoryId:'test-cat',category:'測試分類',text:'本機測試條款',severity:2,sortOrder:1,isCore:false,coreOrder:null,updatedAt:'2026-01-01T00:00:00Z'};
  const remoteClause = {...clause,text:'雲端測試條款'};
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a3sAAAAASUVORK5CYII=';
  await page.addInitScript(({clause}) => {
    sessionStorage.setItem('kino_quotation_cloud_auth_token','mock-token');
    sessionStorage.setItem('kino_quotation_cloud_auth_user',JSON.stringify({email:'test@example.invalid'}));
    localStorage.setItem('kino_quotation_clause_library_v1',JSON.stringify([clause]));
    localStorage.setItem('kino_quotation_clause_categories_v1',JSON.stringify([{id:'test-cat',name:'測試分類',sortOrder:1,updatedAt:'2026-01-01T00:00:00Z'}]));
    localStorage.setItem('kino_quotation_onedrive_folder_v1',JSON.stringify({id:'test-folder',name:'測試目錄',accountHomeId:'test-account'}));
    localStorage.setItem('kino_quotation_onedrive_autosave_v1','true');
    localStorage.setItem('kino_quotation_mobile_toolbar_expanded','true');
    localStorage.setItem('kino_quotation_project_library_v1',JSON.stringify([{id:'mock-project-id',name:'美科尾牙平面攝影',data:{header:{quotationId:'測試報價單'}}}]));
    localStorage.setItem('kino_quotation_stamp_assets_v1',JSON.stringify([{id:'mock-stamp',name:'本機印章',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a3sAAAAASUVORK5CYII=',versionId:'local-version'}]));
  },{clause});
  await context.route('**/*', async route => {
    const request=route.request(), url=request.url();
    if (url.includes('msal-browser-5.17.3.min.js')) return route.fulfill({status:200,contentType:'application/javascript',body:`window.msal={InteractionRequiredAuthError:class extends Error{},PublicClientApplication:class {async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return window.__backupRestoreTest ? [] : [{homeAccountId:'test-account',username:'test@example.invalid'}]} setActiveAccount(a){this.a=a} getActiveAccount(){return this.a} async acquireTokenSilent(){return {accessToken:'mock'}}}};`});
    if (url.includes('kino-quotation-data-api.film-kinostudio.workers.dev')) {
      if (request.method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'*'}});
      calls.push(request.method()+' '+new URL(url).pathname);
      let data={};
      if (url.endsWith('/api/config')) data={microsoftClientId:'mock-client'};
      else if (url.endsWith('/api/pdf')) {
        console.log('Rendering mock PDF');
        const {renderPrintPdf}=await import('../cloud-sync/src/pdf-render.js');
        const fs=require('node:fs');
        const ctx=await browser.newContext({javaScriptEnabled:false});
        const pdfPage=await ctx.newPage();
        let handler;
        const adapter={
          setJavaScriptEnabled:async()=>{},setViewport:v=>pdfPage.setViewportSize({width:v.width,height:v.height}),
          setRequestInterception:async()=>{await pdfPage.route('**/*',route=>handler({method:()=>route.request().method(),url:()=>route.request().url(),continue:()=>route.continue(),abort:()=>route.abort()}));},
          on:(name,fn)=>{handler=fn;},emulateMediaType:media=>pdfPage.emulateMedia({media}),
          setContent:(...args)=>pdfPage.setContent(...args),evaluate:fn=>pdfPage.evaluate(fn),$$eval:(...args)=>pdfPage.$$eval(...args),pdf:options=>pdfPage.pdf(options)
        };
        const {bytes,fields}=await renderPrintPdf(adapter,JSON.parse(request.postData()),'data:font/ttf;base64,'+fs.readFileSync('assets/pdf/NotoSansTC-Regular.ttf').toString('base64'));
        pdfOutputs.push(bytes);
        await ctx.close();
        return route.fulfill({status:200,contentType:'application/pdf',headers:{'access-control-allow-origin':'*','access-control-expose-headers':'x-pdf-client-fields','x-pdf-client-fields':Buffer.from(JSON.stringify(fields)).toString('base64')},body:Buffer.from(bytes)});
      }
      else if (url.endsWith('/api/auth/me')) data={user:{email:'test@example.invalid'}};
      else if (url.endsWith('/api/stamps')) data={assets:[{id:'mock-stamp',name:'雲端印章',versionId:'remote-version'}]};
      else if (url.includes('/api/stamps/mock-stamp/content')) return route.fulfill({status:200,contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:Buffer.from(png,'base64')});
      else if (url.endsWith('/api/sync') && request.method()==='GET') data={projects:[],templates:[],categories:[{id:'test-cat',name:'測試分類',sortOrder:1,updatedAt:clause.updatedAt}],clauses:[remoteClause],clauseLibraryInitialized:true,clauseCategoriesInitialized:true};
      else if (url.endsWith('/api/sync') && request.method()==='POST') data={written:[{key:'clauses',id:'test-clause',action:'save'}],skipped:[]};
      else throw Error('Unexpected API request '+request.method()+' '+url);
      return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
    }
    if (url.includes('graph.microsoft.com')) {
      if (request.method()==='GET' && url.includes('/items/test-folder:/')) return route.fulfill({status:404,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"error":{"message":"Not found"}}'});
      if (request.method()==='POST' && url.endsWith('/items/test-folder/children')) {
        const data=JSON.parse(request.postData());folderCreates.push(data);
        return route.fulfill({status:201,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({id:'created-project-folder',name:data.name,folder:{}})});
      }
      if (request.method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'PUT,GET,OPTIONS','access-control-allow-headers':'*'}});
      if(request.method()==='PUT') {
        activeUploads++; maxActive=Math.max(maxActive,activeUploads);
        uploads.push({url,body:request.postData()});
        if (uploads.length===1) await new Promise(resolve=>setTimeout(resolve,5000));
        activeUploads--;
        return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"name":"mock.json"}'});
      }
      return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"value":[]}'});
    }
    if (url.startsWith('https://qt.test/') || url.startsWith('https://newqt.test/')) {
      const path=require('node:path'), fs=require('node:fs');
      const root=path.resolve(__dirname,'..'), target=path.resolve(root,'.'+decodeURIComponent(new URL(url).pathname));
      if (!target.startsWith(root+path.sep)) throw Error('Invalid fixture path');
      return route.fulfill({status:200,contentType:target.endsWith('.html')?'text/html':target.endsWith('.js')?'application/javascript':target.endsWith('.svg')?'image/svg+xml':target.endsWith('.ttf')?'font/ttf':'application/octet-stream',body:fs.readFileSync(target)});
    }
    if (url.includes('unpkg.com') || url.includes('cdn.tailwindcss.com')) return route.continue();
    return route.abort();
  });
  await page.goto('https://qt.test/index.html',{waitUntil:'domcontentloaded',timeout:45000});
  await page.getByRole('button',{name:'快速報價',exact:true}).first().waitFor({timeout:30000});
  await page.waitForTimeout(1000);
  console.log('TAILWIND',await page.evaluate(()=>({tailwind:typeof tailwind,styles:document.styleSheets.length})));
  await page.locator('button:visible').filter({hasText:'同步帳號資料'}).click();
  await page.getByText('本機測試條款',{exact:false}).first().waitFor({timeout:10000});
  const body=await page.locator('body').innerText();
  assert.match(body,/雲端測試條款/);
  assert.match(body,/本機測試條款/);
  assert.match(body,/修改：條款內容/);
  assert.match(body,/將新增完整專案「美科尾牙平面攝影」/);
  assert.doesNotMatch(body,/mock-project-id|schemaVersion|data.header/);
  await page.getByRole('button',{name:'本機 1',exact:true}).first().click();
  assert.ok(await page.locator('[aria-label="完整專案差異摘要"]').isVisible());
  assert.equal(await page.locator('img[alt="本機印章縮圖"]').count(),1);
  assert.equal(await page.locator('img[alt="雲端印章縮圖"]').count(),1);
  assert.doesNotMatch(body,/versionId：/);
  await page.locator('label').filter({hasText:'測試分類'}).locator('input[type=checkbox]').check();
  assert.match(await page.locator('body').innerText(),/已勾選 1 \/ 3 筆/);
  await page.getByRole('button',{name:'合併已勾選項目'}).click();
  await page.getByRole('status').waitFor();
  assert.match(await page.getByRole('status').innerText(),/已同步 1 條條款/);
  assert.doesNotMatch(await page.getByRole('status').innerText(),/D1|test-clause/);
  assert.equal(await page.getByRole('button',{name:/^(選擇印章|調整印章)$/}).count(),0);
  await page.getByRole('button',{name:'設定印章',exact:true}).first().click();
  assert.equal(await page.getByText('本機印章',{exact:true}).count(),1);
  await page.getByRole('button',{name:'向上蓋住公司資訊'}).click();
  const overlap=await page.locator('.stamp-preview-signature-cell.is-active').evaluate(cell=>({overflow:getComputedStyle(cell).overflow,top:cell.querySelector('.stamp-preview-visual').getBoundingClientRect().top,cellTop:cell.getBoundingClientRect().top}));
  assert.equal(overlap.overflow,'visible');
  assert.ok(overlap.top<overlap.cellTop,'印章應跨出簽署格上緣');
  const setRange=async(name,value)=>page.getByRole('slider',{name,exact:true}).evaluate((input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);
  await setRange('X 位移滑桿',12);
  await setRange('Y 位移滑桿',-18);
  for(const opacity of [0,45,100]) {
    await setRange('印章透明度',opacity);
    assert.equal(await page.locator('.stamp-preview-visual').first().evaluate(el=>getComputedStyle(el).opacity),String(opacity/100));
  }
  await setRange('印章透明度',45);
  await page.getByRole('slider',{name:'X 位移滑桿',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('slider',{name:'X 位移滑桿',exact:true}).inputValue(),'12.1');
  await setRange('X 位移滑桿',12);
  await page.screenshot({path:'tmp/stamp-controls-mobile.png'});
  await page.getByRole('button',{name:'套用至本報價單／儲存印章設定',exact:true}).click();
  await page.setViewportSize({width:1366,height:1000});
  await page.getByRole('button',{name:'設定印章',exact:true}).first().click();
  assert.ok(await page.getByRole('slider',{name:'Y 位移滑桿',exact:true}).isVisible());
  assert.equal(await page.getByRole('slider',{name:'印章透明度',exact:true}).inputValue(),'45');
  await page.screenshot({path:'tmp/stamp-controls-desktop.png'});
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  const validity=page.locator('input[aria-label="有效期限內容"]:visible');
  await validity.fill('模擬存檔內容');
  for(let i=0;i<50 && uploads.length<1;i++) await page.waitForTimeout(100);
  assert.equal(uploads.length,1,'第一筆自動存檔未送出');
  await validity.fill('模擬較新內容');
  for(let i=0;i<100 && uploads.length<2;i++) await page.waitForTimeout(100);
  assert.equal(uploads.length,2,'第二筆自動存檔未送出');
  assert.equal(maxActive,1,'兩筆 OneDrive 上傳不應同時執行');
  assert.match(uploads.at(-1).url,/test-folder/);
  assert.equal(JSON.parse(uploads[0].body).header.validity,'模擬存檔內容');
  assert.equal(JSON.parse(uploads.at(-1).body).signature.clientStamp.allowOverflow,true);
  assert.ok(JSON.parse(uploads.at(-1).body).signature.clientStamp.yMm<0);
  assert.equal(JSON.parse(uploads.at(-1).body).signature.clientStamp.xMm,12);
  assert.equal(JSON.parse(uploads.at(-1).body).signature.clientStamp.yMm,-18);
  assert.equal(JSON.parse(uploads.at(-1).body).signature.clientStamp.opacity,45);
  assert.equal(JSON.parse(uploads.at(-1).body).header.validity,'模擬較新內容');
  await page.locator('button:visible').filter({hasText:/OneDrive/}).first().click();
  await page.getByRole('button',{name:'立即儲存到 OneDrive'}).click();
  for(let i=0;i<50 && uploads.length<3;i++) await page.waitForTimeout(100);
  assert.equal(uploads.length,3,'手動 OneDrive 存檔未送出');
  assert.equal(JSON.parse(uploads[2].body).header.validity,'模擬較新內容');
  await page.getByRole('checkbox',{name:/依報價單號自動建立專案資料夾/}).check();
  assert.ok(await page.getByText('測試目錄',{exact:true}).isVisible());
  assert.ok(await page.getByRole('button',{name:'立即儲存到 OneDrive'}).isEnabled(),'已選資料夾應直接成為上級目錄');
  await page.getByRole('button',{name:'立即儲存到 OneDrive'}).click();
  for(let i=0;i<50 && uploads.length<4;i++) await page.waitForTimeout(100);
  assert.equal(uploads.length,4);
  assert.match(uploads[3].url,/items\/created-project-folder:/);
  assert.equal(folderCreates.length,1);
  assert.equal(folderCreates[0]['@microsoft.graph.conflictBehavior'],'fail');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kino_quotation_onedrive_parent_folder_v1')).id),'test-folder');
  await page.getByRole('checkbox',{name:/依報價單號自動建立專案資料夾/}).uncheck();
  await page.setViewportSize({width:1366,height:1000});
  await page.getByRole('checkbox',{name:/依報價單號自動建立專案資料夾/}).check();
  assert.ok(await page.getByText('測試目錄',{exact:true}).isVisible(),'再次切換不可把已建立子資料夾當成上級目錄');
  await page.setViewportSize({width:390,height:844});
  assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'關閉 OneDrive 設定'}).click();
  await page.getByRole('button',{name:'資料庫管理',exact:true}).click();
  await page.getByRole('button',{name:'備份／遷站',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'還原到此瀏覽器並重新載入'}).isEnabled(),false,'登入期間不可還原');
  const backupDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'下載完整本機備份',exact:true}).click();
  const backupPath=await (await backupDownload).path();
  const backupText=require('node:fs').readFileSync(backupPath,'utf8');
  assert.ok(!backupText.includes('mock-token'));
  const backup=JSON.parse(backupText);
  assert.equal(JSON.parse(backup.entries.kino_quotation_project_library_v1)[0].name,'美科尾牙平面攝影');
  await page.screenshot({path:'tmp/backup-mobile.png'});
  await page.getByRole('button',{name:'關閉資料庫管理'}).click();
  const dest=await context.newPage();
  dest.setDefaultTimeout(10000);
  await dest.addInitScript(()=>{window.__backupRestoreTest=true;localStorage.setItem('kino_quotation_mobile_toolbar_expanded','true');});
  await dest.goto('https://newqt.test/index.html',{waitUntil:'domcontentloaded',timeout:45000});
  await dest.getByRole('button',{name:'資料庫管理',exact:true}).waitFor({timeout:30000});
  await dest.waitForTimeout(1000);
  await dest.getByRole('button',{name:'資料庫管理',exact:true}).click();
  await dest.getByRole('button',{name:'備份／遷站',exact:true}).click();
  const safety=dest.waitForEvent('download');
  await dest.getByRole('button',{name:'下載完整本機備份',exact:true}).click();
  await safety;
  await dest.locator('input[type=file]:visible').setInputFiles(backupPath);
  await dest.getByText('檢查碼正確。還原會取代此網址本機資料，不會自動合併或上傳。').waitFor();
  await dest.getByRole('checkbox',{name:'我已確認另存目前資料的備份，並已關閉其他 QT 分頁'}).check();
  const writeCount=calls.filter(c=>!c.startsWith('GET')).length, uploadCount=uploads.length;
  dest.once('dialog',dialog=>dialog.accept());
  await dest.getByRole('button',{name:'還原到此瀏覽器並重新載入'}).click();
  await dest.waitForLoadState('load');
  await dest.getByRole('button',{name:'快速報價',exact:true}).first().waitFor({timeout:30000});
  await dest.waitForFunction(()=>JSON.parse(localStorage.getItem('kino_quotation_draft_v2') || '{}').header?.validity==='模擬較新內容',{},{timeout:10000});
  const restored=await dest.evaluate(()=>({draft:JSON.parse(localStorage.getItem('kino_quotation_draft_v2')),projects:JSON.parse(localStorage.getItem('kino_quotation_project_library_v1')),autosave:localStorage.getItem('kino_quotation_onedrive_autosave_v1'),token:sessionStorage.getItem('kino_quotation_cloud_auth_token')}));
  assert.equal(restored.projects[0].name,'美科尾牙平面攝影');
  assert.equal(restored.draft.header.validity,'模擬較新內容');
  assert.equal(restored.autosave,'false');assert.equal(restored.token,null);
  assert.equal(calls.filter(c=>!c.startsWith('GET')).length,writeCount);
  assert.equal(uploads.length,uploadCount);
  await dest.close();
  const helper=await context.newPage();
  await helper.goto('https://qt.test/assets/migration-backup.html');
  const legacyExport=helper.waitForEvent('download');
  await helper.getByRole('button',{name:'下載此網址的完整本機備份'}).click();
  const legacyFile=await (await legacyExport).path();
  const legacyBackup=JSON.parse(require('node:fs').readFileSync(legacyFile,'utf8'));
  assert.equal(legacyBackup.entries.kino_quotation_draft_v2,backup.entries.kino_quotation_draft_v2);
  assert.ok(!JSON.stringify(legacyBackup).includes('mock-token'));
  assert.equal(calls.filter(c=>!c.startsWith('GET')).length,writeCount);
  await helper.close();
  console.log('PASS 兩個隔離網址完整本機備份／還原，未觸發雲端寫入');
  if (process.env.TEST_PDF==='1') {
    const download=page.waitForEvent('download',{timeout:60000});
    await page.getByRole('button',{name:'下載報價單 PDF',exact:true}).first().click();
    const file=await download;
    await file.saveAs('tmp/pdfs/client-form-quick.pdf');
    const {PDFDocument}=require('../cloud-sync/node_modules/pdf-lib');
    const doc=await PDFDocument.load(require('node:fs').readFileSync('tmp/pdfs/client-form-quick.pdf'));
    assert.equal(doc.getForm().getFields().length,4);
    assert.equal(pdfOutputs.length,1);
    for (const [type,scale] of [['quick',70],['detailed',85]]) {
      if(type==='detailed') await page.getByRole('button',{name:'詳細報價',exact:true}).first().click();
      const next=page.waitForEvent('download',{timeout:60000});
      await page.evaluate(scale=>window.dispatchEvent(new CustomEvent('quotation-download-pdf',{detail:{scale}})),scale);
      const target='tmp/pdfs/client-form-'+type+'-'+scale+'.pdf';
      await (await next).saveAs(target);
      const pdf=await PDFDocument.load(require('node:fs').readFileSync(target));
      assert.equal(pdf.getForm().getFields().length,4);
      if(type==='detailed') assert.ok(pdf.getPageCount()>=2);
    }
    console.log('PASS 真實列印版型下載含四個甲方 AcroForm 欄位');
  }
  console.log('PASS 差異面板顯示本機／雲端條款變化；模擬 OneDrive 自動儲存內容與資料夾正確。');
  console.log('MOCK calls:',calls.join(', '),'uploads:',uploads.length);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
