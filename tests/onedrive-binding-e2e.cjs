// Real editor + binding handler + SQLite; Microsoft/Graph responses are isolated doubles.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
(async()=>{
  const {handleOneDriveBinding}=await import('../cloud-sync/src/onedrive-binding.js');
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync('cloud-sync/migrations/0010_onedrive_binding.sql','utf8'));
  sqlite.exec("CREATE TABLE cloud_projects(id TEXT PRIMARY KEY,data_json TEXT); INSERT INTO cloud_projects VALUES('sentinel','unchanged');");
  const DB={prepare(query){return{bind(...values){const args=Object.fromEntries(values.map((v,i)=>['?'+(i+1),v]));return{
    async first(){return sqlite.prepare(query).get(args)||null;},async run(){return{meta:{changes:Number(sqlite.prepare(query).run(args).changes)}};}
  };}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={DB,ONEDRIVE_BINDING_ENABLED:'true',MICROSOFT_CLIENT_ID:'test-client',MICROSOFT_CLIENT_SECRET:'test-only-secret',
    ONEDRIVE_TOKEN_KEY:Buffer.alloc(32,1).toString('base64url'),ONEDRIVE_REDIRECT_URI:'https://qt.kinostudio.tw/onedrive-link.html'};
  const auth={type:'google',workspaceId:'user:isolated',user:{id:'isolated',email:'owner@example.invalid',name:'Isolated'}};
  const graphCalls=[],uploads=[],creates=[];
  const folder=(id='root',name='OneDrive')=>({id,name,folder:{},...(id==='root'?{root:{}}:{}),parentReference:{driveId:'drive!isolated',path:'/drives/drive!isolated/root:'}});
  const provider=async(url,options)=>{
    graphCalls.push({url,method:options.method||'GET'});
    if(url.includes('/token'))return Response.json({access_token:'test-access',refresh_token:'test-refresh'});
    if(url.includes('/me/drive'))return Response.json({id:'drive!isolated',owner:{user:{displayName:'Isolated OneDrive'}}});
    if(options.method==='PUT'){uploads.push({url,quotation:JSON.parse(options.body)});return Response.json({id:'file!test'});}
    if(options.method==='POST'){const body=JSON.parse(options.body);creates.push(body);return Response.json(folder('new-project',body.name));}
    if(url.endsWith('/root')||url.endsWith('/items/root'))return Response.json(folder());
    if(url.includes('/children'))return Response.json({value:[folder('existing','Existing')]});
    if(url.includes(':/'))return Response.json({error:{code:'itemNotFound'}},{status:404});
    throw Error('Unexpected isolated Graph URL '+url);
  };
  const direct=(suffix,body)=>handleOneDriveBinding(new Request('https://api.test/api/onedrive'+suffix,{method:'POST',body:JSON.stringify(body)}),env,auth,provider);
  const verifier='a'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
  const start=await(await direct('/start',{challenge})).json();
  await direct('/complete',{state:start.state,code:'test-code',verifier});
  const beforeRestore=graphCalls.length;
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const root=path.resolve(__dirname,'..'),origin='https://qt.kinostudio.tw',api='https://kino-quotation-data-api.film-kinostudio.workers.dev';
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await context.addInitScript(()=>{sessionStorage.setItem('kino_quotation_cloud_auth_token','isolated-google-session');localStorage.setItem('kino_quotation_mobile_toolbar_expanded','true');});
    await context.route('**/*',async route=>{
      const r=route.request(),url=new URL(r.url());
      if(url.origin===api){
        const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'};
        if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});
        let response;
        if(url.pathname==='/api/config')response=Response.json({oneDriveBindingEnabled:true});
        else if(url.pathname==='/api/auth/me')response=Response.json({user:auth.user});
        else{
          assert.equal(r.headers().authorization,'Bearer isolated-google-session');
          try{response=await handleOneDriveBinding(new Request(r.url(),{method:r.method(),headers:r.headers(),body:r.postDataBuffer()||undefined}),env,auth,provider);}
          catch(e){console.error('Isolated API rejected',url.pathname,e.status,e.message);response=Response.json({error:e.message,code:e.code},{status:e.status||500});}
        }
        return route.fulfill({status:response.status,headers,contentType:'application/json',body:await response.text()});
      }
      if(url.origin===origin){const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert.ok(file.startsWith(root+path.sep));return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});}
      if(['unpkg.com','cdn.tailwindcss.com'].includes(url.hostname))return route.continue();
      return route.abort();
    });
    const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'選擇 OneDrive 資料夾',exact:true}).click();
    assert.equal(graphCalls.length,beforeRestore,'restoring Google binding must not refresh or write Graph');
    await page.getByRole('checkbox',{name:/依報價單號自動建立專案資料夾/}).check();
    await page.getByRole('button',{name:'立即儲存到 OneDrive'}).click();
    await page.getByRole('button',{name:'Existing',exact:true}).waitFor();
    const selected=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/onedrive/folder'&&r.request().method()==='POST');
    await page.getByRole('button',{name:'設為上級目錄',exact:true}).click();
    assert.equal((await selected).status(),200);
    await page.getByText('/',{exact:true}).waitFor();
    assert.equal(uploads.length,0,'selecting a folder must not upload the draft');
    assert.equal(await page.getByRole('checkbox',{name:/自動儲存 JSON/}).isChecked(),false);
    await page.getByRole('button',{name:'立即儲存到 OneDrive'}).click();
    await page.getByText(/^已存至 OneDrive：/).waitFor();
    assert.equal(uploads.length,1);assert.equal(creates.length,1);
    const id=uploads[0].quotation.header.quotationId;
    assert.equal(creates[0].name,id.replace(/\s*[_-]\s*KS\d+\s*$/i,'').trim());
    assert.match(uploads[0].url,/items\/new-project:/);
    assert.ok(decodeURIComponent(uploads[0].url).endsWith('/'+id+'.json:/content'));
    assert.equal(sqlite.prepare("SELECT data_json FROM cloud_projects WHERE id='sentinel'").get().data_json,'unchanged');
    assert.deepEqual(errors,[]);
    console.log('PASS mobile real binding handler + SQLite: restore zero writes, select parent, create project folder and save actual quotation JSON; existing project sentinel unchanged');
    await context.close();
  }finally{await browser.close();sqlite.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
