const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const {Miniflare,convertV4MiniflareOptions}=createRequire(path.resolve('cloud-sync/package.json'))('miniflare');

(async()=>{
  const {signingBody}=await import('./fixtures/signing.mjs');
  const {signingSha256,SIGNING_SQL}=await import('../cloud-sync/src/signing-store.js');
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:path.resolve('tmp/signing-worker-bundle/index.js'),compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],cf:false,
    bindings:{SIGNING_ENABLED:'true',SIGNING_ALLOWED_EMAILS:'owner@example.test',ALLOWED_ORIGINS:'https://qt.kinostudio.tw'},
    d1Databases:['DB'],d1Persist:false,r2Buckets:['STAMP_BUCKET'],r2Persist:false,
    ratelimits:{PDF_RATE_LIMITER:{namespace_id:'1001',simple:{limit:2,period:60}}}
  }));
  try {
    const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('STAMP_BUCKET');
    // This migration has only CREATE statements; keep each trigger body together.
    const migration=fs.readFileSync('cloud-sync/migrations/0008_quote_signing.sql','utf8');
    for(const statement of migration.split(/(?<=;)\s*(?=CREATE)/)) await db.prepare(statement).run();
    await db.prepare('CREATE TABLE cloud_users(id TEXT PRIMARY KEY,email TEXT,display_name TEXT,picture_url TEXT)').run();
    await db.prepare('CREATE TABLE cloud_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at TEXT)').run();
    const session='local-runtime-owner-session-0123456';
    await db.prepare('INSERT INTO cloud_users VALUES(?1,?2,?3,?4)').bind('owner-test','owner@example.test','TEST ONLY','').run();
    await db.prepare('INSERT INTO cloud_sessions VALUES(?1,?2,?3)').bind(await signingSha256(session),'owner-test','2099-01-01T00:00:00Z').run();
    const created=await mf.dispatchFetch('https://api.test/api/signing',{method:'POST',headers:{Origin:'https://qt.kinostudio.tw',Authorization:'Bearer '+session,'Content-Type':'application/json'},body:JSON.stringify(signingBody())});
    assert.equal(created.status,201,await created.clone().text());
    const share=await created.json();
    const guest=await mf.dispatchFetch('https://api.test/api/signing/guest',{headers:{Origin:'https://quote.kinostudio.tw',Authorization:'Quote '+share.token}});
    assert.equal(guest.status,200);assert.equal((await guest.json()).snapshot.quotation.header.quotationId,'TEST-ONLY-001');
    const claimArgs=[await signingSha256(share.token),Date.now(),'quote-signing/v1/local-test/submission.json','a'.repeat(64),'b'.repeat(64)];
    assert.equal((await db.prepare(SIGNING_SQL.claim).bind(...claimArgs).first()).status,'submitting');
    assert.equal(await db.prepare(SIGNING_SQL.claim).bind(...claimArgs).first(),null);
    await assert.rejects(db.prepare("UPDATE quote_signing_requests SET snapshot_key='changed'").run(),/immutable signing snapshot/);
    await db.prepare(SIGNING_SQL.lease).bind(share.id,Date.now(),'test-render-lease').first();
    assert.equal((await db.prepare(SIGNING_SQL.finish).bind(share.id,'a'.repeat(64),'quote-signing/v1/local-test/final.pdf','c'.repeat(64),Date.now(),'test-render-lease').first()).status,'signed');
    await assert.rejects(db.prepare("UPDATE quote_signing_requests SET signed_pdf_key='replacement.pdf'").run(),/immutable signed PDF/);
    assert.equal((await mf.dispatchFetch('https://api.test/api/signing/'+share.id,{method:'DELETE',headers:{Origin:'https://qt.kinostudio.tw',Authorization:'Bearer '+session}})).status,200);
    assert.equal((await mf.dispatchFetch('https://api.test/api/signing/guest',{headers:{Origin:'https://quote.kinostudio.tw',Authorization:'Quote '+share.token}})).status,404);
    const first=await bucket.put('quote-signing/v1/local-conditional-test','original',{onlyIf:{etagDoesNotMatch:'*'}});
    assert.ok(first);
    assert.equal(await bucket.put('quote-signing/v1/local-conditional-test','replacement',{onlyIf:{etagDoesNotMatch:'*'}}),null);
    assert.equal(await (await bucket.get('quote-signing/v1/local-conditional-test')).text(),'original');
    assert.equal((await mf.dispatchFetch('https://api.test/api/sync',{headers:{Origin:'https://quote.kinostudio.tw',Authorization:'Quote '+share.token}})).status,403);
    console.log('PASS 隔離workerd的真實D1/R2 bindings：建立／讀取／撤銷、單次claim、不可改寫快照／PDF、R2條件寫入與客戶來源隔離');
  } finally {await mf.dispose();}
})().catch(error=>{console.error(error);process.exit(1);});
