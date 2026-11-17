const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [], uploads = [], calls = [];
  let activeUploads=0, maxActive=0;
  page.on('pageerror', e => errors.push(e.message));
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
    localStorage.setItem('kino_quotation_stamp_assets_v1',JSON.stringify([{id:'mock-stamp',name:'本機印章',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a3sAAAAASUVORK5CYII=',versionId:'local-version'}]));
  },{clause});
  await page.route('**/*', async route => {
    const request=route.request(), url=request.url();
    if (url.includes('msal-browser-5.17.3.min.js')) return route.fulfill({status:200,contentType:'application/javascript',body:`window.msal={InteractionRequiredAuthError:class extends Error{},PublicClientApplication:class {async initialize(){} async handleRedirectPromise(){return null} getAllAccounts(){return [{homeAccountId:'test-account',username:'test@example.invalid'}]} setActiveAccount(a){this.a=a} getActiveAccount(){return this.a} async acquireTokenSilent(){return {accessToken:'mock'}}}};`});
    if (url.includes('kino-quotation-data-api.film-kinostudio.workers.dev')) {
      if (request.method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'*'}});
      calls.push(request.method()+' '+new URL(url).pathname);
      let data={};
      if (url.endsWith('/api/config')) data={microsoftClientId:'mock-client'};
      else if (url.endsWith('/api/auth/me')) data={user:{email:'test@example.invalid'}};
      else if (url.endsWith('/api/stamps')) data={assets:[{id:'mock-stamp',name:'雲端印章',versionId:'remote-version'}]};
      else if (url.includes('/api/stamps/mock-stamp/content')) return route.fulfill({status:200,contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:Buffer.from(png,'base64')});
      else if (url.endsWith('/api/sync') && request.method()==='GET') data={projects:[],templates:[],categories:[{id:'test-cat',name:'測試分類',sortOrder:1,updatedAt:clause.updatedAt}],clauses:[remoteClause],clauseLibraryInitialized:true,clauseCategoriesInitialized:true};
      else throw Error('Unexpected API request '+request.method()+' '+url);
      return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
    }
    if (url.includes('graph.microsoft.com')) {
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
    if (url.startsWith('file:') || url.includes('unpkg.com') || url.includes('cdn.tailwindcss.com')) return route.continue();
    return route.abort();
  });
  await page.goto('file:///C:/Users/Aaron/Documents/Codex/KINO%20Quota/index.html',{waitUntil:'domcontentloaded',timeout:45000});
  await page.getByRole('button',{name:'快速報價',exact:true}).first().waitFor({timeout:30000});
  await page.waitForTimeout(1000);
  console.log('TAILWIND',await page.evaluate(()=>({tailwind:typeof tailwind,styles:document.styleSheets.length})));
  await page.locator('button:visible').filter({hasText:'同步帳號資料'}).click();
  await page.getByText('本機測試條款',{exact:false}).first().waitFor({timeout:10000});
  const body=await page.locator('body').innerText();
  assert.match(body,/雲端測試條款/);
  assert.match(body,/本機測試條款/);
  assert.match(body,/text：雲端 "雲端測試條款" → 本機 "本機測試條款"/);
  assert.equal(await page.locator('img[alt="本機印章縮圖"]').count(),1);
  assert.equal(await page.locator('img[alt="雲端印章縮圖"]').count(),1);
  assert.doesNotMatch(body,/versionId：/);
  await page.locator('label').filter({hasText:'本機測試條款'}).locator('input[type=checkbox]').check();
  assert.match(await page.locator('body').innerText(),/已勾選 1 \/ 2 筆/);
  await page.locator('button:visible').filter({hasText:'取消'}).first().click();
  await page.getByRole('button',{name:'選擇印章'}).first().click();
  assert.equal(await page.getByText('本機印章',{exact:true}).count(),1);
  await page.getByRole('button',{name:'取消',exact:true}).first().click();
  if (await page.getByRole('button',{name:'放棄修改'}).isVisible()) await page.getByRole('button',{name:'放棄修改'}).click();
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
  assert.equal(JSON.parse(uploads.at(-1).body).header.validity,'模擬較新內容');
  await page.locator('button:visible').filter({hasText:/OneDrive/}).first().click();
  await page.getByRole('button',{name:'立即儲存到 OneDrive'}).click();
  for(let i=0;i<50 && uploads.length<3;i++) await page.waitForTimeout(100);
  assert.equal(uploads.length,3,'手動 OneDrive 存檔未送出');
  assert.equal(JSON.parse(uploads[2].body).header.validity,'模擬較新內容');
  assert.deepEqual(errors,[]);
  console.log('PASS 差異面板顯示本機／雲端條款變化；模擬 OneDrive 自動儲存內容與資料夾正確。');
  console.log('MOCK calls:',calls.join(', '),'uploads:',uploads.length);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
