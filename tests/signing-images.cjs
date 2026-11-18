const {chromium}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
  const {rasterizeSigningImages,validateSigningCreate}=await import('../cloud-sync/src/signing-validation.js');
  const {signingBody}=await import('./fixtures/signing.mjs');
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    const page=await browser.newPage(),requests=[];
    page.on('request',request=>requests.push(request.url()));
    const source=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.fillStyle='#105482';ctx.fillRect(4,4,24,24);return canvas.toDataURL('image/png');});
    const adapter={async setRequestInterception(){await page.route('**/*',route=>route.abort());},on(){},setContent:html=>page.setContent(html),evaluate:(fn,arg)=>page.evaluate(fn,arg)};
    const body=signingBody();body.snapshot.quotation.logo=source;
    body.snapshot.quotation.signature.vendorStamp.sourceDataUrl=source;
    body.snapshot.quotation.signature.vendorStamp.assetId='stamp-test-only';
    const validated=validateSigningCreate(body);
    const normalized=await rasterizeSigningImages(adapter,validated.snapshot);
    assert.match(normalized.quotation.logo,/^data:image\/png;base64,/);
    const dimensions=await page.evaluate(async source=>{const img=new Image();img.src=source;await img.decode();return [img.naturalWidth,img.naturalHeight];},normalized.quotation.signature.vendorStamp.sourceDataUrl);
    assert.deepEqual(dimensions,[32,32]);
    const truncated=signingBody();truncated.snapshot.quotation.logo='data:image/png;base64,'+Buffer.from(source.split(',')[1],'base64').subarray(0,40).toString('base64');
    validateSigningCreate(truncated);
    await assert.rejects(rasterizeSigningImages(adapter,truncated.snapshot));
    const bomb=Buffer.from(source.split(',')[1],'base64');bomb.writeUInt32BE(5000,16);
    const huge=signingBody();huge.snapshot.quotation.logo='data:image/png;base64,'+bomb.toString('base64');
    assert.throws(()=>validateSigningCreate(huge),/格式不正確/);
    assert.ok(requests.every(url=>url.startsWith('data:')),'圖片驗證不可對外連線');
    console.log('PASS 本機Chromium實際解碼、重新編碼、拒絕損壞PNG與過大尺寸；無外部圖片請求');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
