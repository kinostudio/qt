const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

(async()=>{
  const {validateSigningCreate}=await import('../cloud-sync/src/signing-validation.js');
  const {renderSigningPdf,prepareSigningPage}=await import('../cloud-sync/src/signing-render.js');
  const {PDFDocument}=require('../cloud-sync/node_modules/pdf-lib');
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const font='data:font/ttf;base64,'+fs.readFileSync('assets/pdf/NotoSansTC-Regular.ttf').toString('base64');
  try {
    const context=await browser.newContext({viewport:{width:1200,height:900}}),page=await context.newPage();
    const apiCalls=[];
    await context.route('**/*',async route=>{
      const url=route.request().url();
      if(url.startsWith('https://qt.test/')) {
        const root=path.resolve(__dirname,'..'),target=path.resolve(root,'.'+decodeURIComponent(new URL(url).pathname));
        assert.ok(target.startsWith(root+path.sep));
        return route.fulfill({body:fs.readFileSync(target),contentType:target.endsWith('.html')?'text/html':target.endsWith('.js')?'application/javascript':target.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});
      }
      if(url.includes('kino-quotation-data-api')) {
        apiCalls.push(route.request().method()+' '+new URL(url).pathname);
        assert.ok(url.endsWith('/api/config'),'No cloud data requests are allowed');
        return route.fulfill({json:{},headers:{'access-control-allow-origin':'*'}});
      }
      if(url.includes('unpkg.com') || url.includes('cdn.tailwindcss.com')) return route.continue();
      return route.abort();
    });
    await page.goto('https://qt.test/index.html',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'快速報價',exact:true}).first().waitFor({timeout:45000});
    await page.evaluate(()=>{
      const data=JSON.parse(localStorage.getItem('kino_quotation_draft_v2'));
      data.header.quotationId='TEST-SIGNING-001';data.taxMode='included';
      data.items[data.categories[0].id][0].price=100000;
      localStorage.setItem('kino_quotation_draft_v2',JSON.stringify(data));
    });
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'快速報價',exact:true}).first().waitFor({timeout:45000});
    const signatureImage=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=240;c.height=90;
      const x=c.getContext('2d');x.strokeStyle='#105482';x.lineWidth=4;x.strokeRect(5,5,230,80);
      x.font='28px sans-serif';x.fillStyle='#105482';x.fillText('TEST ONLY',25,55);return c.toDataURL();
    });
    fs.mkdirSync('tmp/pdfs',{recursive:true});
    for(const type of ['quick','detailed']) {
      if(type==='detailed') await page.getByRole('button',{name:'詳細報價',exact:true}).first().click();
      const snapshot=await page.evaluate(()=>new Promise((resolve,reject)=>window.dispatchEvent(new CustomEvent('quotation-signing-snapshot',{detail:{scale:95,resolve,reject}}))));
      validateSigningCreate({confirmed:true,snapshot});
      assert.ok(!snapshot.printDocument.html.includes('data:image/svg+xml'));
      assert.match(snapshot.printDocument.html,/105,000/);
      const submission={clientCompany:'簽署測試股份有限公司',clientContact:'測試甲方',clientTaxId:'12345678',clientPhone:'0912345678',signatureKind:'stamp',signatureImage};
      const renderContext=await browser.newContext({javaScriptEnabled:false}),p=await renderContext.newPage();
      let handler;
      const adapter={setJavaScriptEnabled:async()=>{},setViewport:v=>p.setViewportSize({width:v.width,height:v.height}),
        setRequestInterception:async()=>{await p.unrouteAll();await p.route('**/*',r=>handler({method:()=>r.request().method(),url:()=>r.request().url(),continue:()=>r.continue(),abort:()=>r.abort()}));},
        on:(_,fn)=>{handler=fn;},emulateMediaType:media=>p.emulateMedia({media}),setContent:(...args)=>p.setContent(...args),evaluate:(...args)=>p.evaluate(...args),$$eval:(...args)=>p.$$eval(...args),pdf:options=>p.pdf(options)};
      const before=await renderSigningPdf(adapter,snapshot,null,font);
      const unchanged=()=>p.evaluate(()=>{const copy=document.body.cloneNode(true);copy.querySelectorAll('[data-pdf-client-field],[data-signing-client-signature]').forEach(n=>n.replaceChildren());return copy.innerText||copy.textContent;});
      const originalText=await unchanged();
      const bytes=await renderSigningPdf(adapter,snapshot,submission,font);
      assert.equal(await unchanged(),originalText,'Only client fields and signature may change');
      assert.deepEqual(await p.locator('[data-pdf-client-field]').allTextContents(),Object.values(submission).slice(0,4));
      assert.equal(await p.locator('[data-signing-client-signature] img').count(),1);
      const originalPdf=await PDFDocument.load(before),signedPdf=await PDFDocument.load(bytes);
      assert.equal(signedPdf.getPageCount(),originalPdf.getPageCount(),'Signing must not add pages');
      assert.equal(signedPdf.getForm().getFields().length,0,'Final signed document is not an editable form');
      fs.writeFileSync(`tmp/pdfs/signing-${type}.pdf`,bytes);
      console.log(`PASS ${type}: ${signedPdf.getPageCount()} pages, client fields only, static signed PDF`);
      await assert.rejects(prepareSigningPage(adapter,snapshot,{...submission,clientCompany:'測'.repeat(200)},font),/SIGNING_CLIENT_TEXT_TOO_LONG/);
      await renderContext.close();
    }
    assert.ok(apiCalls.every(call=>call==='GET /api/config'));
    console.log('PASS actual editor capture + Chromium PDFs; no cloud data reads/writes');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
