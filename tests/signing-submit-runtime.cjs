const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const localRequire=createRequire(path.resolve('cloud-sync/package.json'));
const {Miniflare,convertV4MiniflareOptions}=localRequire('miniflare');

(async()=>{
  const {signingBody}=await import('./fixtures/signing.mjs');
  await localRequire('esbuild').build({entryPoints:['tests/fixtures/signing-submit-worker.mjs'],bundle:true,format:'esm',platform:'browser',external:['node:*'],outfile:'tmp/signing-submit-runtime.js'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:path.resolve('tmp/signing-submit-runtime.js'),compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],cf:false,d1Databases:['DB'],d1Persist:false,r2Buckets:['STAMP_BUCKET'],r2Persist:false}));
  try {
    const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('STAMP_BUCKET');
    for(const sql of fs.readFileSync('cloud-sync/migrations/0008_quote_signing.sql','utf8').split(/(?<=;)\s*(?=CREATE)/)) await db.prepare(sql).run();
    const post=(route,body,token)=>mf.dispatchFetch('https://test.invalid'+route,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Quote '+token}:{})},body:JSON.stringify(body)});
    const share=await (await post('/create',signingBody())).json();
    const body={idempotencyKey:crypto.randomUUID(),snapshotSha256:share.snapshotSha256,clientCompany:'TEST ONLY',clientContact:'TEST',clientTaxId:'',clientPhone:'',signatureKind:'handwritten',consent:true,signatureImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a3sAAAAASUVORK5CYII='};
    assert.equal((await post('/submit?simulate-failure',body,share.token)).status,503);
    assert.equal((await db.prepare('SELECT status FROM quote_signing_requests WHERE id=?1').bind(share.id).first()).status,'submitting');
    const completed=await post('/submit',body,share.token);assert.equal(completed.status,200,await completed.clone().text());
    const receipt=await completed.json();assert.equal(receipt.status,'signed');
    assert.equal((await post('/submit?simulate-failure',body,share.token)).status,200,'signed retry must not call the failing renderer');
    assert.equal((await post('/submit',{...body,clientCompany:'CHANGED'},share.token)).status,409);
    const download=await mf.dispatchFetch('https://test.invalid/pdf',{headers:{authorization:'Quote '+share.token}});
    assert.equal(download.status,200);assert.equal(download.headers.get('x-test-sha256'),receipt.pdfSha256);
    assert.match(await download.text(),/TEST-BYTES-NOT-A-REAL-DOCUMENT/);
    assert.equal((await bucket.list({prefix:`quote-signing/v1/${share.id}/signed/`})).objects.length,1);
    console.log('PASS 隔離workerd完整送出儲存流程：產檔失敗保留提交、同內容重試、不可覆寫及固定檔案讀取；未驗證正式PDF版型');
  } finally {await mf.dispose();}
})().catch(error=>{console.error(error);process.exit(1);});
