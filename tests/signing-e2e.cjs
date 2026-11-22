// Isolated integration: real app pages, API handlers, SQLite and Chromium PDFs.
// Google identity, R2 and the Browser Run transport are local test doubles only.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');

(async()=>{
  const {handleSigningGuest,handleSigningOwner}=await import('../cloud-sync/src/signing-api.js');
  const {rasterizeSigningImages}=await import('../cloud-sync/src/signing-validation.js');
  const {renderSigningPdf,prepareSigningPage}=await import('../cloud-sync/src/signing-render.js');
  const {renderPrintPdf}=await import('../cloud-sync/src/pdf-render.js');
  const {SigningError,signingSha256}=await import('../cloud-sync/src/signing-store.js');
  const {PDFDocument}=require('../cloud-sync/node_modules/pdf-lib');
  const {getDocument}=await import('file:///C:/Users/Aaron/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const sql=new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync('cloud-sync/migrations/0008_quote_signing.sql','utf8'));
  sql.exec("CREATE TABLE cloud_projects(id TEXT,data TEXT);INSERT INTO cloud_projects VALUES('sentinel','KEEP');");
  const DB={prepare(query){return{bind(...values){const params=Object.fromEntries(values.map((v,i)=>['?'+(i+1),v]));return{async first(){return sql.prepare(query).get(params)||null;},async all(){return{results:sql.prepare(query).all(params)};},async run(){return{meta:{changes:Number(sql.prepare(query).run(params).changes)}};}};}};}};
  const objects=new Map(),STAMP_BUCKET={async put(key,value,options){assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});if(failNextFinal&&key.includes('/signed/')){failNextFinal=false;throw Error('SIMULATED_FINAL_STORAGE_FAILURE');}if(objects.has(key))return null;objects.set(key,{bytes:typeof value==='string'?Buffer.from(value):Buffer.from(value),metadata:options.customMetadata});return{key};},async get(key){const object=objects.get(key);if(!object)return null;return{size:object.bytes.length,customMetadata:object.metadata,text:async()=>object.bytes.toString(),arrayBuffer:async()=>Uint8Array.from(object.bytes).buffer};}};
  const env={DB,STAMP_BUCKET,SIGNING_SUBMIT_ENABLED:'true',SIGNING_ALLOWED_EMAILS:'owner@example.test',SIGNING_LINK_SECRET:'test-only-link-key-not-a-real-secret-12345678',PDF_RATE_LIMITER:{limit:async()=>({success:true})}};
  const auth={type:'google',workspaceId:'user:e2e-owner',user:{id:'e2e-owner',email:'owner@example.test'}};
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const font='data:font/ttf;base64,'+fs.readFileSync('assets/pdf/NotoSansTC-Regular.ttf').toString('base64');
  let failNextFinal=false,finalRenders=0,renderCalls=0;const calls=[],submitted=[];
  async function renderContext(){
    const context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();let handler;
    const adapter={setJavaScriptEnabled:async()=>{},setViewport:v=>page.setViewportSize({width:v.width,height:v.height}),
      setRequestInterception:async()=>{await page.unrouteAll();await page.route('**/*',r=>handler({method:()=>r.request().method(),url:()=>r.request().url(),continue:()=>r.continue(),abort:()=>r.abort()}));},
      on:(_,fn)=>{handler=fn;},emulateMediaType:media=>page.emulateMedia({media}),setContent:(...args)=>page.setContent(...args),evaluate:(...args)=>page.evaluate(...args),$$eval:(...args)=>page.$$eval(...args),pdf:options=>page.pdf(options)};
    return{context,adapter};
  }
  const createSession=()=>{
    const contexts=[];return{
      async prepareSnapshot(snapshot){const r=await renderContext();contexts.push(r.context);return rasterizeSigningImages(r.adapter,snapshot);},
      async validateImage(_image,{snapshot,submission}){const r=await renderContext();contexts.push(r.context);await prepareSigningPage(r.adapter,snapshot,submission,font);},
      async renderPdf({snapshot,submission}){
        renderCalls++;
        if(submission?.consent){if(failNextFinal){failNextFinal=false;throw Error('SIMULATED_FINAL_RENDER_FAILURE');}finalRenders++;}
        const r=await renderContext();contexts.push(r.context);return renderSigningPdf(r.adapter,snapshot,submission,font);
      },async close(){await Promise.all(contexts.map(context=>context.close()));}
    };
  };
  const decode=async(_env,snapshot)=>{const r=await renderContext();try{return await rasterizeSigningImages(r.adapter,snapshot);}finally{await r.context.close();}};
  const root=path.resolve(__dirname,'..');
  async function install(context,owner){
    await context.route('**/*',async route=>{
      const input=route.request(),url=new URL(input.url());
      if(url.origin==='https://editor.test'||url.origin==='https://quote.kinostudio.tw'){
        const base=url.origin==='https://editor.test'?root:path.join(root,'signing-client'),relative=url.pathname.startsWith('/s/')?'/index.html':url.pathname;
        const file=path.resolve(base,'.'+decodeURIComponent(relative));assert.ok(file.startsWith(base+path.sep));
        return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});
      }
      if(url.hostname==='kino-quotation-data-api.film-kinostudio.workers.dev'){
        const headers={'access-control-allow-origin':owner?'https://editor.test':'https://quote.kinostudio.tw','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'};
        if(input.method()==='OPTIONS')return route.fulfill({status:204,headers});
        calls.push({owner,method:input.method(),path:url.pathname});
        try{
          let response;const request=new Request(input.url(),{method:input.method(),headers:input.headers(),body:input.postDataBuffer()||undefined});
          if(owner){
            if(url.pathname==='/api/config')response=Response.json({signingEnabled:true});
            else{
              assert.equal(input.headers().authorization,'Bearer e2e-mock-session');
              if(url.pathname==='/api/auth/me')response=Response.json({user:auth.user});
              else if(url.pathname==='/api/stamps')response=Response.json({assets:[]});
              else if(url.pathname==='/api/sync'&&input.method()==='GET')response=Response.json({projects:[],templates:[],categories:[],clauses:[]});
              else if(url.pathname==='/api/pdf'){
                const r=await renderContext();try{const result=await renderPrintPdf(r.adapter,await request.json(),font);response=new Response(result.bytes,{headers:{'content-type':'application/pdf'}});}finally{await r.context.close();}
              }else response=await handleSigningOwner(request,env,auth,decode,createSession);
            }
          }else{
            assert.match(input.headers().authorization,/^Quote [A-Za-z0-9_-]{43}$/);
            assert.equal(input.headers().referer,undefined);
            if(input.method()==='POST'&&url.pathname.endsWith('/guest'))submitted.push(JSON.parse(input.postData()));
            response=await handleSigningGuest(request,env,createSession);
          }
          return route.fulfill({status:response.status,headers:{...Object.fromEntries(response.headers),...headers,'access-control-expose-headers':'x-content-sha256'},body:Buffer.from(await response.arrayBuffer())});
        }catch(error){if(!(error instanceof SigningError))throw error;return route.fulfill({status:error.status,json:{error:error.message},headers});}
      }
      if(owner&&(url.hostname==='unpkg.com'||url.hostname==='cdn.tailwindcss.com'))return route.continue();
      return route.abort();
    });
  }
  try{
    fs.mkdirSync('tmp/pdfs',{recursive:true});
    const owner=await browser.newContext({viewport:{width:1280,height:900}});await install(owner,true);
    await owner.addInitScript(()=>{sessionStorage.setItem('kino_quotation_cloud_auth_token','e2e-mock-session');sessionStorage.setItem('kino_quotation_cloud_auth_user',JSON.stringify({email:'owner@example.test'}));});
    const editor=await owner.newPage();editor.setDefaultTimeout(60000);await editor.goto('https://editor.test/index.html',{waitUntil:'domcontentloaded'});await editor.getByRole('button',{name:'快速報價',exact:true}).waitFor();
    const baseline=await editor.evaluate(()=>JSON.parse(localStorage.getItem('kino_quotation_draft_v2')));
    for(const type of ['quick','detailed']){
      console.log('BEGIN isolated '+type+' full signing flow');
      const q=structuredClone(baseline);q.header.quotationId='TEST-E2E-'+type.toUpperCase();q.taxMode='included';q.items[q.categories[0].id][0].price=100000;q.notes[0].text='固定測試條款：未經雙方同意，不變更本報價。';
      await editor.evaluate(q=>localStorage.setItem('kino_quotation_draft_v2',JSON.stringify(q)),q);await editor.reload({waitUntil:'domcontentloaded'});await editor.getByRole('button',{name:'快速報價',exact:true}).waitFor();
      if(type==='detailed')await editor.getByRole('button',{name:'詳細報價',exact:true}).click();
      await editor.getByRole('button',{name:'客戶簽署',exact:true}).click();const manager=editor.getByRole('dialog',{name:'客戶簽署管理'});
      const beforeOwner=renderCalls;
      await manager.getByRole('button',{name:'準備固定版本並預覽'}).click();await manager.getByRole('status').filter({hasText:'固定版本已備妥'}).waitFor();await manager.getByRole('checkbox').check();await manager.getByRole('button',{name:'建立客戶簽署連結'}).click();await manager.getByRole('status').filter({hasText:'已建立不可隨草稿變動'}).waitFor();
      assert.equal(renderCalls,beforeOwner+1,'owner prepare and create render only once');
      const shareUrl=await manager.getByLabel('客戶專用連結',{exact:true}).inputValue();const row=sql.prepare('SELECT * FROM quote_signing_requests WHERE quotation_id=?').get(q.header.quotationId),frozen=Buffer.from(objects.get(row.snapshot_key).bytes);
      await manager.getByRole('button',{name:'關閉簽署管理'}).click();
      await editor.evaluate(()=>{const q=JSON.parse(localStorage.getItem('kino_quotation_draft_v2'));q.header.quotationId='DRAFT-CHANGED';q.notes[0].text='DRAFT-CHANGED-DO-NOT-SIGN';q.items[q.categories[0].id][0].price=1;localStorage.setItem('kino_quotation_draft_v2',JSON.stringify(q));});await editor.reload({waitUntil:'domcontentloaded'});await editor.getByRole('button',{name:'客戶簽署',exact:true}).waitFor();
      const customer=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await install(customer,false);const client=await customer.newPage();client.setDefaultTimeout(60000);await client.goto(shareUrl);await client.locator('#form').waitFor();
      assert.equal(await client.locator('#quote-title').innerText(),q.header.quotationId);await client.locator('#original').click();await client.locator('#review').waitFor();
      assert.equal(renderCalls,beforeOwner+1,'customer original reuses the owner PDF');
      await client.getByLabel('公司／抬頭',{exact:true}).fill('完整串接測試有限公司');await client.getByLabel('姓名／代表人',{exact:true}).fill('簽署測試甲方');await client.getByLabel('統一編號',{exact:true}).fill('12345678');await client.getByLabel('聯絡電話',{exact:true}).fill('0912345678');
      if(type==='quick'){
        await client.locator('#canvas').scrollIntoViewIfNeeded();const r=await client.locator('#canvas').boundingBox();await client.mouse.move(r.x+25,r.y+30);await client.mouse.down();await client.mouse.move(r.x+120,r.y+60);await client.mouse.move(r.x+180,r.y+25);await client.mouse.up();
      }else{
        await client.locator('#stamp').click();const image=await client.evaluate(()=>{const c=document.createElement('canvas');c.width=300;c.height=120;const x=c.getContext('2d');x.strokeStyle=x.fillStyle='#105482';x.lineWidth=4;x.strokeRect(5,5,290,110);x.font='32px sans-serif';x.fillText('E2E TEST ONLY',18,75);return c.toDataURL().split(',')[1];});await client.locator('#file').setInputFiles({name:'e2e-stamp.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await client.locator('#stamp-image').waitFor();
      }
      const beforePreview=objects.size;await client.locator('#preview').click();await client.getByRole('status').filter({hasText:'預覽已完成'}).waitFor();assert.equal(objects.size,beforePreview+1);assert.equal(sql.prepare('SELECT status FROM quote_signing_requests WHERE id=?').get(row.id).status,'pending');
      const previewBytes=Buffer.from([...objects.entries()].find(([key])=>key.startsWith(`quote-signing/v1/${row.id}/client-preview-`))[1].bytes);
      const submitStart=submitted.length;failNextFinal=type==='quick';await client.locator('#consent').check();await client.locator('#confirm').click();
      if(type==='quick'){await client.getByRole('alert').filter({hasText:'簽署內容已保存'}).waitFor();assert.equal(sql.prepare('SELECT status FROM quote_signing_requests WHERE id=?').get(row.id).status,'submitting');await client.reload();await client.locator('#retry').waitFor();await client.locator('#retry-submit').click();}
      await client.locator('#done').waitFor();if(type==='quick')assert.deepEqual(submitted[submitStart+1],submitted[submitStart]);
      const clientDownload=client.waitForEvent('download');await client.locator('#download').click();await(await clientDownload).saveAs(`tmp/pdfs/e2e-${type}-client.pdf`);
      await editor.getByRole('button',{name:'客戶簽署',exact:true}).click();await manager.getByRole('status').filter({hasText:'可準備本份報價'}).waitFor();const card=manager.locator('article').filter({has:editor.getByRole('heading',{name:q.header.quotationId,exact:true})});
      const ownerDownload=editor.waitForEvent('download');await card.getByRole('button',{name:'下載已簽 PDF',exact:true}).click();await(await ownerDownload).saveAs(`tmp/pdfs/e2e-${type}-owner.pdf`);
      const clientBytes=fs.readFileSync(`tmp/pdfs/e2e-${type}-client.pdf`),ownerBytes=fs.readFileSync(`tmp/pdfs/e2e-${type}-owner.pdf`);assert.deepEqual(clientBytes,ownerBytes);
      assert.deepEqual(clientBytes,previewBytes);assert.equal(renderCalls,beforeOwner+2,'final confirmation and retry must not render again');
      const signed=sql.prepare('SELECT * FROM quote_signing_requests WHERE id=?').get(row.id);assert.equal(await signingSha256(clientBytes),signed.signed_pdf_sha256);assert.deepEqual(objects.get(row.snapshot_key).bytes,frozen);
      const pdf=await PDFDocument.load(clientBytes);assert.equal(pdf.getPageCount(),type==='quick'?1:2);assert.equal(pdf.getForm().getFields().length,0);
      const extracted=await getDocument({data:new Uint8Array(clientBytes),useSystemFonts:false}).promise;let text='';
      for(let n=1;n<=extracted.numPages;n++)text+=(await(await extracted.getPage(n)).getTextContent()).items.map(item=>item.str).join('');await extracted.destroy();text=text.normalize('NFKC');
      for(const expected of ['完整串接測試有限公司','簽署測試甲方','100,000','105,000','固定測試條款'])assert.ok(text.includes(expected),'Missing signed PDF text: '+expected);assert.ok(!text.includes('DRAFT-CHANGED'));
      await card.getByRole('button',{name:'撤銷客戶連結',exact:true}).click();await card.getByRole('button',{name:'確認撤銷（保留已簽檔）',exact:true}).click();await manager.getByRole('status').filter({hasText:'客戶連結已撤銷'}).waitFor();
      await client.reload();await client.getByRole('alert').filter({hasText:'找不到或連結已失效'}).waitFor();assert.equal(await client.locator('#form').isVisible(),false);
      const archived=await handleSigningOwner(new Request('https://api.test/api/signing/'+row.id+'/pdf'),env,auth);assert.deepEqual(Buffer.from(await archived.arrayBuffer()),clientBytes);
      await manager.getByRole('button',{name:'關閉簽署管理'}).click();await customer.close();console.log('PASS '+type+': actual UI + handlers + SQLite + real PDF, matching owner/client SHA, immutable snapshot, revoke/retain');
    }
    assert.equal(finalRenders,0);assert.equal(renderCalls,4);assert.equal(sql.prepare('SELECT data FROM cloud_projects').get().data,'KEEP');assert.ok(!calls.some(c=>c.path==='/api/sync'&&c.method!=='GET'));
    assert.ok(calls.filter(c=>!c.owner).every(c=>c.path.startsWith('/api/signing/guest')));console.log('PASS full isolated integration; no production storage or Browser Run requests');
  }finally{await browser.close();sql.close();}
})().catch(error=>{console.error(error);process.exit(1);});
