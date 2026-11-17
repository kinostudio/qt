const fs=require('node:fs');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const page=await browser.newPage();
  const runtime='C:/Users/Aaron/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/';
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.hostname!=='reader.test') return route.abort();
    if(u.pathname==='/') return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated PDF reader test</title>'});
    if(u.pathname.startsWith('/lib/')) return route.fulfill({contentType:u.pathname.endsWith('.mjs')?'application/javascript':'application/octet-stream',body:fs.readFileSync(runtime+u.pathname.slice(5))});
    if(/^\/client-form-[a-z0-9-]+\.pdf$/.test(u.pathname)) return route.fulfill({contentType:'application/pdf',body:fs.readFileSync('tmp/pdfs'+u.pathname)});
    return route.abort();
  });
  await page.goto('https://reader.test/');
  for(const file of ['client-form-quick','client-form-quick-70','client-form-detailed-85']) {
    const result=await page.evaluate(async file=>{
      const {getDocument,GlobalWorkerOptions}=await import('/lib/build/pdf.mjs');
      GlobalWorkerOptions.workerSrc='/lib/build/pdf.worker.mjs';
      const pdf=await getDocument({url:'/'+file+'.pdf',standardFontDataUrl:'/lib/standard_fonts/'}).promise;
      const values={clientCompany:'甲方測試有限公司',clientContact:'王小明',clientTaxId:'12345678',clientPhone:'0912345678'};
      let count=0;
      for(let i=1;i<=pdf.numPages;i++) for(const a of await (await pdf.getPage(i)).getAnnotations()) if(Object.hasOwn(values,a.fieldName)){pdf.annotationStorage.setValue(a.id,{value:values[a.fieldName]});count++;}
      if(count!==4) throw Error('Missing fields');
      const bytes=await pdf.saveDocument();
      await pdf.destroy();
      return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob([bytes]));});
    },file);
    fs.writeFileSync('tmp/pdfs/'+file+'-reader-filled.pdf',Buffer.from(result,'base64'));
    console.log('PASS browser PDF reader fills and saves Chinese:',file);
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
