import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createSigningRequest,revokeSigningRequest,signingSha256} from '../cloud-sync/src/signing-store.js';
import {submitSigningRequest,loadSignedPdfForGuest,loadSignedPdfForOwner} from '../cloud-sync/src/signing-submit.js';
import {signingBody} from './fixtures/signing.mjs';
import {loadSigningPreview,previewSigningSubmission} from '../cloud-sync/src/signing-preview.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a3sAAAAASUVORK5CYII=';
// Opaque renderer test bytes only: these tests verify storage, not PDF layout or validity.
const pdf=new TextEncoder().encode('%PDF-1.7\nTEST-RENDERER-BYTES\n%%EOF');
const migration=await fs.readFile('cloud-sync/migrations/0008_quote_signing.sql','utf8');
async function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(migration);t.after(()=>sqlite.close());
  const db={prepare(sql){return {bind(...args){const params=Object.fromEntries(args.map((value,i)=>['?'+(i+1),value]));return {async first(){return sqlite.prepare(sql).get(params)||null;},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(params).changes)}};}};}};}};
  const objects=new Map(),metadata=new Map();
  const bucket={async put(key,value,options){assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});if(objects.has(key))return null;objects.set(key,typeof value==='string'?value:new Uint8Array(value));metadata.set(key,options.customMetadata);return {key};},async get(key){const value=objects.get(key);if(value===undefined)return null;const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return {size:bytes.byteLength,customMetadata:metadata.get(key),async text(){return new TextDecoder().decode(bytes);},async arrayBuffer(){return bytes.slice().buffer;}};}};
  let time=Date.now(),renders=0,verifications=0;
  const services={clock:()=>time,async allowRender(){return true;},async validateImage(){verifications++;},async renderPdf(){renders++;return pdf;}};
  const share=await createSigningRequest(db,bucket,'user:test',signingBody().snapshot,14,time);
  const body={idempotencyKey:crypto.randomUUID(),snapshotSha256:share.snapshotSha256,clientCompany:'測試甲方',clientContact:'測試代表',clientTaxId:'',clientPhone:'',signatureImage:png,signatureKind:'handwritten',consent:true};
  return {sqlite,db,bucket,objects,services,share,body,counts:()=>({renders,verifications}),advance:ms=>{time+=ms;}};
}

const previewBody=body=>{const {idempotencyKey,consent,...fields}=body;return fields;};

test('filled preview permits revisions without storing or accepting any client signature',async t=>{
  const f=await fixture(t),seen=[];
  const original=[...f.objects.entries()];
  f.services.renderPdf=async({submission})=>{seen.push(submission);return pdf;};
  for(const clientCompany of ['第一份預覽','修改後預覽']) {
    const result=await previewSigningSubmission(f.db,f.bucket,f.share.token,{...previewBody(f.body),clientCompany},f.services);
    assert.deepEqual(result.bytes,pdf);
  }
  assert.deepEqual(seen.map(s=>s.clientCompany),['第一份預覽','修改後預覽']);
  assert.ok(seen.every(s=>s.consent===undefined));
  assert.deepEqual([...f.objects.entries()],original);
  assert.equal(f.sqlite.prepare('SELECT status,submission_key FROM quote_signing_requests').get().status,'pending');
  assert.equal(f.sqlite.prepare('SELECT submission_key FROM quote_signing_requests').get().submission_key,null);
  assert.equal((await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services)).status,'signed');
});

test('filled preview rejects changed versions, extra quote fields and invalid images before rendering',async t=>{
  const f=await fixture(t),body=previewBody(f.body);
  for(const fields of [{snapshotSha256:'0'.repeat(64)},{price:1},{signatureImage:'https://untrusted.test/stamp.png'},{consent:true}]) {
    await assert.rejects(previewSigningSubmission(f.db,f.bucket,f.share.token,{...body,...fields},f.services),e=>[400,409].includes(e.status));
  }
  assert.equal(f.counts().renders,0);assert.equal(f.objects.size,1);
});

test('filled preview rate limits and image failures never lock the quotation',async t=>{
  const f=await fixture(t),body=previewBody(f.body);
  f.services.allowRender=async()=>false;
  await assert.rejects(previewSigningSubmission(f.db,f.bucket,f.share.token,body,f.services),e=>e.status===429);
  f.services.allowRender=async()=>true;f.services.validateImage=async()=>{throw new Error('invalid image');};
  await assert.rejects(previewSigningSubmission(f.db,f.bucket,f.share.token,body,f.services),/invalid image/);
  assert.equal(f.counts().renders,0);assert.equal(f.objects.size,1);
  assert.equal(f.sqlite.prepare('SELECT status FROM quote_signing_requests').get().status,'pending');
});

test('filled preview revoked mid-render is discarded without writing client data',async t=>{
  const f=await fixture(t);
  f.services.renderPdf=async()=>{await revokeSigningRequest(f.db,'user:test',f.share.id);return pdf;};
  await assert.rejects(previewSigningSubmission(f.db,f.bucket,f.share.token,previewBody(f.body),f.services),e=>e.status===404);
  assert.equal(f.objects.size,1);
});

test('pending preview is cached without accepting a signature and rejects tampered PDF',async t=>{
  const f=await fixture(t);
  const first=await loadSigningPreview(f.db,f.bucket,f.share.token,f.services);
  assert.deepEqual(first.bytes,pdf);
  assert.deepEqual(await loadSigningPreview(f.db,f.bucket,f.share.token,f.services),first);
  assert.equal(f.counts().renders,1);
  assert.equal(f.sqlite.prepare('SELECT status FROM quote_signing_requests').get().status,'pending');
  const key=[...f.objects.keys()].find(key=>key.includes('/preview-'));
  f.objects.set(key,new TextEncoder().encode('%PDF-tampered'));
  await assert.rejects(loadSigningPreview(f.db,f.bucket,f.share.token,f.services),error=>error.status===503);
});

test('revocation while producing a preview prevents publishing or returning it',async t=>{
  const f=await fixture(t);
  f.services.renderPdf=async()=>{await revokeSigningRequest(f.db,'user:test',f.share.id);return pdf;};
  await assert.rejects(loadSigningPreview(f.db,f.bucket,f.share.token,f.services),error=>error.status===404);
  assert.ok(![...f.objects.keys()].some(key=>key.includes('/preview-')));
});

test('preview usage limit fails before rendering or writing a cached PDF',async t=>{
  const f=await fixture(t);f.services.allowRender=async()=>false;
  await assert.rejects(loadSigningPreview(f.db,f.bucket,f.share.token,f.services),error=>error.status===429);
  assert.equal(f.counts().renders,0);assert.equal(f.objects.size,1);
});

test('first consent freezes client data; identical retry returns the exact same PDF without rerendering',async t=>{
  const f=await fixture(t);
  const signed=await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services);
  assert.equal(signed.status,'signed');assert.ok(signed.pdfSha256);
  f.body.clientCompany='不能更改';
  await assert.rejects(submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services),error=>error.status===409);
  f.body.clientCompany='測試甲方';
  assert.deepEqual(await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services),signed);
  assert.deepEqual(f.counts(),{renders:1,verifications:1});
  const a=await loadSignedPdfForGuest(f.db,f.bucket,f.share.token),b=await loadSignedPdfForOwner(f.db,f.bucket,'user:test',f.share.id);
  assert.deepEqual(a.bytes,pdf);assert.deepEqual(a.bytes,b.bytes);
  assert.equal(a.sha256,await signingSha256(pdf));
  await assert.rejects(loadSignedPdfForOwner(f.db,f.bucket,'user:other',f.share.id),error=>error.status===404);
});

test('different idempotency key cannot replace an accepted signature',async t=>{
  const f=await fixture(t);await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services);
  await assert.rejects(submitSigningRequest(f.db,f.bucket,f.share.token,{...f.body,idempotencyKey:crypto.randomUUID()},f.services),error=>error.status===409);
  assert.equal(f.counts().renders,1);
});

test('two different concurrent signatures accept only one and render only its frozen client data',async t=>{
  const f=await fixture(t),seen=[];
  f.services.renderPdf=async({submission})=>{seen.push(submission.clientCompany);return pdf;};
  const other={...f.body,idempotencyKey:crypto.randomUUID(),clientCompany:'另一位甲方'};
  const results=await Promise.allSettled([submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services),submitSigningRequest(f.db,f.bucket,f.share.token,other,f.services)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
  assert.equal(seen.length,1);
  const row=f.sqlite.prepare('SELECT * FROM quote_signing_requests').get();
  assert.equal(JSON.parse(await (await f.bucket.get(row.submission_key)).text()).clientCompany,seen[0]);
});

test('concurrent identical retry observes the active rendering lease rather than starting a second renderer',async t=>{
  const f=await fixture(t);let finish,started;
  const rendering=new Promise(resolve=>{started=resolve;});
  f.services.renderPdf=()=>{started();return new Promise(resolve=>{finish=resolve;});};
  const first=submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services);
  await rendering;
  const retry=await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services);
  assert.equal(retry.status,'submitting');assert.equal(retry.retryAfter,5);
  finish(pdf);assert.equal((await first).status,'signed');
});

test('PDF failure leaves accepted data immutable and allows the same request to retry',async t=>{
  const f=await fixture(t);f.services.renderPdf=async()=>{throw new Error('temporary renderer failure');};
  await assert.rejects(submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services),error=>error.status===503);
  let row=f.sqlite.prepare('SELECT * FROM quote_signing_requests').get();
  assert.equal(row.status,'submitting');assert.equal(row.render_lease_id,null);
  await assert.rejects(loadSignedPdfForGuest(f.db,f.bucket,f.share.token),error=>error.status===409);
  f.services.renderPdf=async()=>pdf;
  assert.equal((await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services)).status,'signed');
  assert.equal(f.counts().verifications,1);
});

test('expired render job cannot publish over the result of a replacement lease',async t=>{
  const f=await fixture(t);let resolveOld,notifyOld;
  const started=new Promise(resolve=>{notifyOld=resolve;});let calls=0;
  f.services.renderPdf=()=>{if(++calls===1){notifyOld();return new Promise(resolve=>{resolveOld=resolve;});}return pdf;};
  const old=submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services);await started;
  f.advance(120001);
  const current=await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services);
  assert.equal(current.status,'signed');
  resolveOld(new TextEncoder().encode('%PDF-1.7\nSTALE-RENDERER\n%%EOF'));
  assert.equal((await old).pdfSha256,current.pdfSha256);
  assert.deepEqual((await loadSignedPdfForGuest(f.db,f.bucket,f.share.token)).bytes,pdf);
});

test('revocation during rendering prevents finalization and client downloads while owner retains accepted data',async t=>{
  const f=await fixture(t);
  f.services.renderPdf=async()=>{await revokeSigningRequest(f.db,'user:test',f.share.id);return pdf;};
  await assert.rejects(submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services),error=>error.status===404);
  assert.equal(f.sqlite.prepare('SELECT status FROM quote_signing_requests').get().status,'submitting');
  await assert.rejects(loadSignedPdfForGuest(f.db,f.bucket,f.share.token),error=>error.status===404);
});

test('consent, snapshot binding, image verification and usage protection fail before accepting a signature',async t=>{
  const f=await fixture(t);
  for(const change of [{consent:false},{snapshotSha256:'a'.repeat(64)},{signatureImage:''},{quotation:{total:1}}]) {
    await assert.rejects(submitSigningRequest(f.db,f.bucket,f.share.token,{...f.body,...change},f.services));
  }
  f.services.allowRender=async()=>false;
  await assert.rejects(submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services),error=>error.status===429);
  f.services.allowRender=async()=>true;f.services.validateImage=async()=>{throw new Error('invalid PNG');};
  await assert.rejects(submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services));
  assert.equal(f.sqlite.prepare('SELECT status FROM quote_signing_requests').get().status,'pending');
  assert.equal(f.objects.size,1);
});

test('tampered archived PDF is rejected and expiry blocks guest access but not owner retention',async t=>{
  const f=await fixture(t);await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services);
  await assert.rejects(loadSignedPdfForGuest(f.db,f.bucket,f.share.token,f.share.expiresAt),error=>error.status===404);
  assert.equal((await loadSignedPdfForOwner(f.db,f.bucket,'user:test',f.share.id)).sha256,await signingSha256(pdf));
  const row=f.sqlite.prepare('SELECT * FROM quote_signing_requests').get();f.objects.set(row.signed_pdf_key,new Uint8Array([1,2,3]));
  await assert.rejects(loadSignedPdfForOwner(f.db,f.bucket,'user:test',f.share.id),/完整性/);
});

test('lost D1 response after claim or finalization is recovered without accepting a second signature',async t=>{
  for(const phase of ['claim','finish']) {
    const f=await fixture(t);let once=true;
    const uncertain={prepare(sql){const statement=f.db.prepare(sql);return {bind(...args){const bound=statement.bind(...args);return {...bound,async first(){const row=await bound.first();if(once && row && (phase==='claim'?sql.includes("SET status='submitting'"):sql.includes("SET status='signed'"))){once=false;throw new Error('response lost after commit');}return row;}};}};}};
    await assert.rejects(submitSigningRequest(uncertain,f.bucket,f.share.token,f.body,f.services));
    const row=f.sqlite.prepare('SELECT * FROM quote_signing_requests').get();
    assert.equal(row.status,phase==='claim'?'submitting':'signed');
    const retry=await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services);
    assert.equal(retry.status,'signed');assert.equal(f.counts().renders,1);
    assert.equal(f.counts().verifications,1);
  }
});

test('R2 failure cannot produce signed status, and accepted data retries respect usage protection',async t=>{
  const f=await fixture(t);
  const failing={...f.bucket,async put(key,...args){if(key.endsWith('.pdf'))throw new Error('R2 unavailable');return f.bucket.put(key,...args);}};
  await assert.rejects(submitSigningRequest(f.db,failing,f.share.token,f.body,f.services),error=>error.status===503);
  assert.equal(f.sqlite.prepare('SELECT status FROM quote_signing_requests').get().status,'submitting');
  f.services.allowRender=async()=>false;
  const limited=await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services);
  assert.equal(limited.status,'submitting');assert.equal(limited.retryAfter,60);
  assert.equal(f.counts().renders,1);
  f.services.allowRender=async()=>true;
  assert.equal((await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services)).status,'signed');
});

test('an already-accepted submission can finish after link expiry, but cannot reopen guest download access',async t=>{
  const f=await fixture(t);f.services.renderPdf=async()=>{throw new Error('temporary failure');};
  await assert.rejects(submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services));
  f.advance(15*86400000);f.services.renderPdf=async()=>pdf;
  assert.equal((await submitSigningRequest(f.db,f.bucket,f.share.token,f.body,f.services)).status,'signed');
  await assert.rejects(loadSignedPdfForGuest(f.db,f.bucket,f.share.token,f.share.expiresAt+1),error=>error.status===404);
  assert.deepEqual((await loadSignedPdfForOwner(f.db,f.bucket,'user:test',f.share.id)).bytes,pdf);
});
