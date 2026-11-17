import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../cloud-sync/src/index.js';
import {signingSha256,SIGNING_SQL} from '../cloud-sync/src/signing-store.js';
import {readSigningJson,validateSigningCreate,MAX_SIGNING_BODY_BYTES} from '../cloud-sync/src/signing-validation.js';
import {signingBody} from './fixtures/signing.mjs';

const ownerToken='test-owner-session-012345678901',otherToken='test-other-session-012345678901';
async function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  sqlite.exec(await fs.readFile('cloud-sync/migrations/0008_quote_signing.sql','utf8'));
  const sessions=new Map([[await signingSha256(ownerToken),{user_id:'test-owner',email:'owner@example.test',expires_at:'2099-01-01'}],[await signingSha256(otherToken),{user_id:'test-other',email:'other@example.test',expires_at:'2099-01-01'}]]);
  const calls=[],objects=new Map();
  const env={SIGNING_ENABLED:'true',SIGNING_ALLOWED_EMAILS:'owner@example.test,other@example.test',ALLOWED_ORIGINS:'https://qt.kinostudio.tw',
    PDF_RATE_LIMITER:{async limit(){return {success:true};}},
    DB:{prepare(sql) {return {bind(...values) {
      calls.push({sql,values});const params=Object.fromEntries(values.map((value,i)=>['?'+(i+1),value]));
      return {async first(){return sql.includes('FROM cloud_sessions')?(sessions.get(values[0])||null):(sqlite.prepare(sql).get(params)||null);},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(params).changes)}};}};
    }};}},
    STAMP_BUCKET:{async put(key,contents,options){assert.equal(options.onlyIf.etagDoesNotMatch,'*');objects.set(key,contents);return {key};},async get(key){const value=objects.get(key);if(value===undefined)return null;const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return {size:bytes.byteLength,async text(){return new TextDecoder().decode(bytes);},async arrayBuffer(){return bytes.slice().buffer;}};}}
  };
  return {sqlite,env,calls,objects};
}
function request(path,method='GET',body,token=ownerToken,origin='https://qt.kinostudio.tw') {
  const headers={Origin:origin};if(token) headers.Authorization='Bearer '+token;
  if(body!==undefined) headers['Content-Type']='application/json';
  return new Request('https://api.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
const guestRequest=token=>new Request('https://api.test/api/signing/guest',{headers:{Origin:'https://quote.kinostudio.tw',Authorization:'Quote '+token}});

test('signing is disabled by default without touching D1 or R2',async t=>{
  const {env,calls,objects}=await fixture(t);delete env.SIGNING_ENABLED;
  const response=await worker.fetch(request('/api/signing','POST',signingBody()),env);
  assert.equal(response.status,404);assert.equal(calls.length,0);assert.equal(objects.size,0);
  assert.equal((await (await worker.fetch(request('/api/config'),env)).json()).signingEnabled,false);
});

test('guest CORS cannot unlock editor sync APIs or create signing requests',async t=>{
  const {env}=await fixture(t);
  for(const path of ['/api/sync','/api/stamps','/api/signing']) {
    assert.equal((await worker.fetch(request(path,'GET',undefined,null,'https://quote.kinostudio.tw'),env)).status,403);
  }
  const preflight=await worker.fetch(new Request('https://api.test/api/signing/guest',{method:'OPTIONS',headers:{Origin:'https://quote.kinostudio.tw'}}),env);
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://quote.kinostudio.tw');
  assert.equal((await worker.fetch(request('/api/signing','POST',signingBody(),null),env)).status,401);
});

test('confirmed owner creation, capability reading, workspace isolation and revocation work end to end',async t=>{
  const {env,sqlite,objects}=await fixture(t);
  const created=await worker.fetch(request('/api/signing','POST',signingBody()),env);
  assert.equal(created.status,201);const share=await created.json();
  assert.equal(share.url,'https://quote.kinostudio.tw/s/'+share.token);
  assert.equal(sqlite.prepare('SELECT workspace_id FROM quote_signing_requests').get().workspace_id,'user:test-owner');
  assert.equal(objects.size,1);
  const guest=await worker.fetch(guestRequest(share.token),env);
  assert.equal(guest.status,200);assert.equal(guest.headers.get('cache-control'),'no-store');
  assert.equal(guest.headers.get('referrer-policy'),'no-referrer');
  const quote=await guest.json();assert.equal(quote.snapshot.quotation.header.quotationId,'TEST-ONLY-001');
  assert.ok(!JSON.stringify(quote).includes('user:test-owner'));assert.ok(!JSON.stringify(quote).includes('snapshot_key'));
  assert.equal((await worker.fetch(request('/api/signing/'+share.id,'GET',undefined,otherToken),env)).status,404);
  assert.equal((await worker.fetch(request('/api/signing/'+share.id,'DELETE',undefined,otherToken),env)).status,404);
  assert.equal((await worker.fetch(request('/api/signing/'+share.id,'GET'),env)).status,200);
  assert.equal((await worker.fetch(request('/api/signing/'+share.id,'DELETE'),env)).status,200);
  assert.equal((await worker.fetch(guestRequest(share.token),env)).status,404);
  const preserved=await worker.fetch(request('/api/signing/'+share.id,'GET'),env);
  assert.equal(preserved.status,200);assert.ok((await preserved.json()).revokedAt);
});

test('unknown session, unapproved owner and missing rate limiter fail without snapshot writes',async t=>{
  const {env,objects}=await fixture(t);
  assert.equal((await worker.fetch(request('/api/signing','POST',signingBody(),'unregistered-test-session-12345'),env)).status,401);
  env.SIGNING_ALLOWED_EMAILS='';assert.equal((await worker.fetch(request('/api/signing','POST',signingBody()),env)).status,403);
  env.SIGNING_ALLOWED_EMAILS='owner@example.test';delete env.PDF_RATE_LIMITER;
  assert.equal((await worker.fetch(request('/api/signing','POST',signingBody()),env)).status,503);
  env.PDF_RATE_LIMITER={async limit(){return {success:false};}};
  assert.equal((await worker.fetch(request('/api/signing','POST',signingBody()),env)).status,429);
  assert.equal(objects.size,0);
});

test('owner can retain an expired version while the guest loses access',async t=>{
  const {env,sqlite}=await fixture(t);
  const share=await (await worker.fetch(request('/api/signing','POST',signingBody()),env)).json();
  // Create an already-expired fixture directly; immutable snapshots cannot have their expiry edited.
  const row=sqlite.prepare('SELECT * FROM quote_signing_requests').get();
  const columns=['id','workspace_id','token_hash','snapshot_key','snapshot_sha256','created_at','expires_at'];
  sqlite.prepare('DELETE FROM quote_signing_requests WHERE id=?').run(row.id);
  row.created_at=1;row.expires_at=2;
  sqlite.prepare('INSERT INTO quote_signing_requests('+columns.join(',')+') VALUES(?,?,?,?,?,?,?)').run(...columns.map(key=>row[key]));
  assert.equal((await worker.fetch(guestRequest(share.token),env)).status,404);
  assert.equal((await worker.fetch(request('/api/signing/'+share.id),env)).status,200);
});

test('workspace spoofing, incomplete snapshots and remote images are rejected before storage',async t=>{
  const {env,objects}=await fixture(t);
  for(const mutate of [body=>body.workspaceId='user:other',body=>body.confirmed=false,body=>body.snapshot.quotation.accessToken='NO-SECRET-IN-FIXTURE',body=>body.snapshot.quotation.logo='https://untrusted.test/image.png',body=>body.snapshot.quotation.signature.vendorStamp.assetId='stamp-missing-image',body=>body.snapshot.quotation.items.crew[0].price=null,body=>body.snapshot.quotation.printSettings={}]) {
    const body=signingBody();mutate(body);
    assert.equal((await worker.fetch(request('/api/signing','POST',body),env)).status,400);
  }
  assert.equal(objects.size,0);
});

test('guest cannot use a Google bearer session or mutate the shared snapshot',async t=>{
  const {env,objects}=await fixture(t);
  assert.equal((await worker.fetch(request('/api/signing/guest'),env)).status,404);
  assert.equal((await worker.fetch(new Request('https://api.test/api/signing/guest',{method:'POST',headers:{Origin:'https://quote.kinostudio.tw'}}),env)).status,405);
  assert.equal(objects.size,0);
});

test('guest and owner download identical archived PDF bytes; revocation only blocks guest access',async t=>{
  const {env,sqlite,objects}=await fixture(t);
  const share=await (await worker.fetch(request('/api/signing','POST',signingBody()),env)).json();
  const guestPdf=()=>new Request('https://api.test/api/signing/guest/pdf',{headers:{Origin:'https://quote.kinostudio.tw',Authorization:'Quote '+share.token}});
  assert.equal((await worker.fetch(guestPdf(),env)).status,409);
  const hash=await signingSha256(share.token),at=Date.now();
  sqlite.prepare(SIGNING_SQL.claim).get({'?1':hash,'?2':at,'?3':'test-submission','?4':'a'.repeat(64),'?5':'b'.repeat(64)});
  sqlite.prepare(SIGNING_SQL.lease).get({'?1':share.id,'?2':at,'?3':'test-lease'});
  const bytes=new TextEncoder().encode('%PDF-1.7\nOPAQUE-TEST-ARCHIVE\n%%EOF');
  const pdfHash=await signingSha256(bytes);objects.set('test-final.pdf',bytes);
  sqlite.prepare(SIGNING_SQL.finish).get({'?1':share.id,'?2':'a'.repeat(64),'?3':'test-final.pdf','?4':pdfHash,'?5':at,'?6':'test-lease'});
  const guest=await worker.fetch(guestPdf(),env),owner=await worker.fetch(request('/api/signing/'+share.id+'/pdf'),env);
  assert.equal(guest.status,200);assert.equal(owner.status,200);
  assert.deepEqual(new Uint8Array(await guest.arrayBuffer()),bytes);
  assert.deepEqual(new Uint8Array(await owner.arrayBuffer()),bytes);
  assert.equal(guest.headers.get('x-content-sha256'),pdfHash);
  assert.match(guest.headers.get('content-disposition'),/TEST-ONLY-001\.pdf/);
  assert.equal((await worker.fetch(request('/api/signing/'+share.id+'/pdf','GET',undefined,otherToken),env)).status,404);
  await worker.fetch(request('/api/signing/'+share.id,'DELETE'),env);
  assert.equal((await worker.fetch(guestPdf(),env)).status,404);
  assert.equal((await worker.fetch(request('/api/signing/'+share.id+'/pdf'),env)).status,200);
});

test('streamed JSON is bounded even without content-length and malformed JSON fails closed',async()=>{
  const data=new Uint8Array(MAX_SIGNING_BODY_BYTES+1);
  const stream=new ReadableStream({start(controller){controller.enqueue(data);controller.close();}});
  await assert.rejects(readSigningJson(new Request('https://api.test',{method:'POST',duplex:'half',headers:{'content-type':'application/json'},body:stream})),error=>error.status===413);
  await assert.rejects(readSigningJson(new Request('https://api.test',{method:'POST',headers:{'content-type':'application/json'},body:'{'})),error=>error.status===400);
  await assert.rejects(readSigningJson(new Request('https://api.test',{method:'POST',body:'{}'})),error=>error.status===415);
  assert.equal(validateSigningCreate(signingBody()).snapshot.printScale,95);
});
