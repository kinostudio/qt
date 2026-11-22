// Real editor UI; every application endpoint is intercepted, with no production writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),origin='https://qt.kinostudio.tw',api='https://kino-quotation-data-api.film-kinostudio.workers.dev';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    for(const width of [390,1366]){
      const calls=[],errors=[];let authenticated=true;
      let state={bound:true,revision:'11111111-1111-4111-8111-111111111111',account:{homeAccountId:'isolated-drive',name:'測試帳號',username:'drive@example.invalid'},folder:null,needsReconnect:false};
      const context=await browser.newContext({viewport:{width,height:900}});
      await context.addInitScript(()=>{
        sessionStorage.setItem('kino_quotation_cloud_auth_token','isolated-token');
        localStorage.setItem('kino_quotation_mobile_toolbar_expanded','true');
        localStorage.setItem('kino_quotation_desktop_toolbar_expanded','true');
      });
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin===api){
          const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'};
          if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
          calls.push({path:url.pathname,method:request.method()});
          if(url.pathname==='/api/auth/me'&&!authenticated)return route.fulfill({status:401,headers,contentType:'application/json',body:JSON.stringify({error:'Isolated expired session'})});
          let data={};
          if(url.pathname==='/api/config')data={oneDriveBindingEnabled:true};
          else if(url.pathname==='/api/auth/me')data={user:{id:'isolated',email:'google@example.invalid',name:'測試使用者'}};
          else if(url.pathname==='/api/onedrive')data=state;
          else if(url.pathname==='/api/onedrive/save')data={id:'test-json',name:'test.json'};
          else if(url.pathname==='/api/sync')data={projects:[],templates:[],categories:[],clauses:[]};
          else if(url.pathname==='/api/stamps')data={assets:[]};
          else throw Error('Unexpected application request '+url.pathname);
          return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
        }
        if(url.origin===origin){
          const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
          assert.ok(file.startsWith(root+path.sep));
          return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});
        }
        if(['unpkg.com','cdn.tailwindcss.com'].includes(url.hostname))return route.continue();
        return route.abort();
      });
      const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
      const trigger=()=>page.getByRole('button',{name:'雲端與帳號',exact:true}).filter({visible:true});
      const open=async()=>{await trigger().click();await page.getByRole('dialog',{name:'雲端與帳號設定',exact:true}).waitFor();};
      await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
      const brand=page.locator('img[src="./assets/branding/kino-mark.svg"]').filter({visible:true});
      await brand.waitFor();assert.equal(await brand.count(),1);
      assert.ok(await brand.evaluate(img=>img.complete&&img.naturalWidth>0));
      const arrow=trigger().locator('svg');
      assert.equal(await arrow.getAttribute('aria-hidden'),'true');
      assert.ok(!(await arrow.getAttribute('class')).includes('rotate-180'));
      const arrowBox=await arrow.boundingBox();assert.equal(arrowBox.width,16);assert.equal(arrowBox.height,16);
      await open();
      assert.ok((await arrow.getAttribute('class')).includes('rotate-180'));
      await page.getByText('已綁定・尚未選資料夾',{exact:true}).waitFor();
      await page.getByText('google@example.invalid',{exact:true}).waitFor();
      await page.getByText('drive@example.invalid',{exact:true}).waitFor();
      const panel=page.getByRole('dialog',{name:'雲端與帳號設定',exact:true});
      const bounds=await panel.boundingBox();
      assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,'panel fits viewport');
      if(width===390)assert.ok(Math.abs(bounds.y+bounds.height-900)<2,'mobile sheet is bottom anchored');
      assert.equal(calls.filter(c=>c.method!=='GET').length,0,'opening panel performs no writes');
      await page.keyboard.press('Escape');
      assert.equal(await trigger().getAttribute('aria-expanded'),'false');
      assert.equal(await trigger().evaluate(el=>el===document.activeElement),true,'focus returns to trigger');
      await open();
      await page.getByRole('button',{name:'管理專案與條款',exact:true}).click();
      await page.getByRole('button',{name:'關閉資料庫管理',exact:true}).click();
      assert.equal(calls.filter(c=>c.method!=='GET').length,0,'management does not synchronize');
      await open();
      await page.getByRole('button',{name:'OneDrive 帳號與儲存設定',exact:true}).click();
      await page.getByRole('button',{name:'關閉 OneDrive 設定',exact:true}).click();
      assert.equal(calls.filter(c=>c.method!=='GET').length,0,'settings do not upload');
      state={...state,folder:{id:'isolated-folder',name:'測試資料夾',path:'/測試資料夾',autoCreateProjectFolder:false}};
      await page.reload({waitUntil:'domcontentloaded'});await open();
      await page.getByText('已綁定・已設定資料夾',{exact:true}).waitFor();
      const beforeSync=calls.filter(c=>c.path==='/api/sync').length;
      await page.getByRole('button',{name:'儲存到 OneDrive',exact:true}).click();
      await page.waitForFunction(()=>document.body.innerText.includes('已存至 OneDrive'));
      assert.equal(calls.filter(c=>c.path==='/api/onedrive/save').length,1);
      assert.equal(calls.filter(c=>c.path==='/api/sync').length,beforeSync,'file save never triggers database sync');
      await open();
      await page.emulateMedia({media:'print'});
      assert.equal(await panel.isVisible(),false,'panel never prints');
      await page.emulateMedia({media:'screen'});
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('button',{name:'關閉雲端面板',exact:true}).evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.getByRole('button',{name:'OneDrive 帳號與儲存設定',exact:true}).evaluate(el=>el===document.activeElement),true,'keyboard focus stays in panel');
      await page.screenshot({path:`tmp/cloud-panel-${width}.png`});
      const syncResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sync');
      await page.getByRole('button',{name:'檢視同步差異',exact:true}).click();
      await syncResponse;
      assert.equal(calls.filter(c=>c.path==='/api/onedrive/save').length,1,'database diff never saves OneDrive');
      assert.equal(calls.filter(c=>c.method!=='GET'&&c.path!=='/api/onedrive/save').length,0);
      state={...state,needsReconnect:true};await page.reload({waitUntil:'domcontentloaded'});await open();
      await page.getByRole('button',{name:'重新連接 OneDrive',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'儲存到 OneDrive',exact:true}).count(),0);
      state={bound:false};await page.reload({waitUntil:'domcontentloaded'});await open();
      await page.getByRole('button',{name:'連接 OneDrive',exact:true}).waitFor();
      await page.getByText('尚未連接 Microsoft 帳號',{exact:true}).waitFor();
      authenticated=false;await page.reload({waitUntil:'domcontentloaded'});await open();
      await page.getByRole('button',{name:'Google 登入',exact:true}).waitFor();
      assert.equal(calls.filter(c=>c.method!=='GET'&&c.path!=='/api/onedrive/save').length,0);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}px cloud panel: account/folder distinction, no-write open/settings/manage, save/sync separation, reconnect, focus and layout`);
      await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
