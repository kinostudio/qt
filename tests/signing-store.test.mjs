import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createSigningRequest,loadSigningSnapshot,revokeSigningRequest,signingSha256,SIGNING_SQL} from '../cloud-sync/src/signing-store.js';

const migration=await fs.readFile('cloud-sync/migrations/0008_quote_signing.sql','utf8');
const now=1794910000000;
const fakeSnapshot=()=>({quotation:{header:{quotationId:'TEST-ONLY'},notes:[{text:'固定測試條款'}],signature:{vendorCompany:'測試公司'}},printScale:95,rendererVersion:1});
function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(migration);
  t.after(()=>sqlite.close());
  const db={prepare(sql) {return {bind(...values) {
    const params=Object.fromEntries(values.map((value,i)=>['?'+(i+1),value]));
    return {async run() {return {meta:{changes:Number(sqlite.prepare(sql).run(params).changes)}};},async first() {return sqlite.prepare(sql).get(params)||null;}};
  }};}};
  const objects=new Map();
  const bucket={async put(key,text,options) {
    assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});
    assert.equal(options.httpMetadata.cacheControl,'private, no-store');
    if(objects.has(key)) return null;
    objects.set(key,text);return {key};
  },async get(key) {const text=objects.get(key);return text===undefined?null:{size:Buffer.byteLength(text),async text(){return text;}};}};
  return {sqlite,db,bucket,objects};
}

test('signing migration adds only independent tables and leaves existing data unchanged',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const files=(await fs.readdir('cloud-sync/migrations')).filter(file=>file.endsWith('.sql')&&file<'0008').sort();
  for(const file of files) db.exec(await fs.readFile('cloud-sync/migrations/'+file,'utf8'));
  db.exec("INSERT INTO cloud_projects(workspace_id,id,name,data_json,updated_at) VALUES('test-workspace','sentinel','KEEP','{}','2026-01-01')");
  const tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const before=tables.map(table=>({schema:table,rows:db.prepare('SELECT * FROM "'+table.name+'"').all()}));
  db.exec(migration);
  for(const table of before) {
    assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table.schema.name).sql,table.schema.sql);
    assert.deepEqual(db.prepare('SELECT * FROM "'+table.schema.name+'"').all(),table.rows);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM quote_signing_requests').get().n,0);
});

test('snapshot is frozen independently from the draft and raw share token is never stored in D1',async t=>{
  const {sqlite,db,bucket,objects}=fixture(t), draft=fakeSnapshot();
  const share=await createSigningRequest(db,bucket,'user:test',draft,14,now);
  assert.match(share.token,/^[A-Za-z0-9_-]{43}$/);
  const row=sqlite.prepare('SELECT * FROM quote_signing_requests').get();
  assert.equal(row.token_hash,await signingSha256(share.token));
  assert.ok(!JSON.stringify(row).includes(share.token));
  assert.ok(row.snapshot_key.startsWith('quote-signing/v1/'));
  assert.equal(share.expiresAt,now+14*86400000);
  draft.quotation.notes[0].text='草稿後續變更';
  const loaded=await loadSigningSnapshot(db,bucket,share.token,now);
  assert.equal(loaded.snapshot.quotation.notes[0].text,'固定測試條款');
  assert.equal(loaded.snapshot.printScale,95);
  assert.deepEqual(Object.keys(loaded).sort(),['expiresAt','id','snapshot','snapshotSha256','status']);
  objects.set(row.snapshot_key,'{}');
  await assert.rejects(loadSigningSnapshot(db,bucket,share.token,now),/完整性/);
});

test('expired, revoked and invalid guest links fail; another workspace cannot revoke',async t=>{
  const {db,bucket}=fixture(t);
  const share=await createSigningRequest(db,bucket,'user:test',fakeSnapshot(),1,now);
  await assert.rejects(loadSigningSnapshot(db,bucket,'invalid',now),error=>error.status===404);
  await assert.rejects(loadSigningSnapshot(db,bucket,share.token,share.expiresAt),error=>error.status===404);
  assert.equal(await revokeSigningRequest(db,'user:other',share.id,now),false);
  assert.equal((await loadSigningSnapshot(db,bucket,share.token,now)).status,'pending');
  assert.equal(await revokeSigningRequest(db,'user:test',share.id,now),true);
  assert.equal(await revokeSigningRequest(db,'user:test',share.id,now),false);
  await assert.rejects(loadSigningSnapshot(db,bucket,share.token,now),error=>error.status===404);
});

test('atomic claim accepts exactly one submission, freezes it, and final PDF cannot be replaced',async t=>{
  const {sqlite,db,bucket}=fixture(t);
  const share=await createSigningRequest(db,bucket,'user:test',fakeSnapshot(),14,now);
  const tokenHash=await signingSha256(share.token), submissionHash='a'.repeat(64);
  const claim=sqlite.prepare(SIGNING_SQL.claim);
  const values={'?1':tokenHash,'?2':now+1,'?3':'quote-signing/v1/test/submission.json','?4':submissionHash,'?5':'b'.repeat(64)};
  assert.equal(claim.get(values).status,'submitting');
  assert.equal(claim.get({...values,'?4':'c'.repeat(64)}),undefined);
  assert.throws(()=>sqlite.exec("UPDATE quote_signing_requests SET status='pending'"));
  assert.throws(()=>sqlite.exec("UPDATE quote_signing_requests SET submission_sha256='"+'c'.repeat(64)+"'"),/immutable client submission/);
  const finish=sqlite.prepare(SIGNING_SQL.finish);
  sqlite.prepare(SIGNING_SQL.lease).get({'?1':share.id,'?2':now+1,'?3':'test-render-lease'});
  const pdf={'?1':share.id,'?2':submissionHash,'?3':'quote-signing/v1/test/final.pdf','?4':'d'.repeat(64),'?5':now+2,'?6':'test-render-lease'};
  assert.equal(finish.get({...pdf,'?2':'f'.repeat(64)}),undefined);
  assert.equal(finish.get(pdf).status,'signed');
  assert.equal(finish.get(pdf),undefined);
  assert.throws(()=>sqlite.exec("UPDATE quote_signing_requests SET signed_pdf_key='replacement.pdf'"),/immutable signed PDF/);
  assert.throws(()=>sqlite.exec("UPDATE quote_signing_requests SET snapshot_key='draft.json'"),/immutable signing snapshot/);
  assert.equal(await revokeSigningRequest(db,'user:test',share.id,now+3),true);
  const row=sqlite.prepare('SELECT * FROM quote_signing_requests').get();
  assert.equal(row.status,'signed');
  assert.equal(row.signed_pdf_key,pdf['?3']);
});

test('missing hashes cannot bypass SQL checks, and revoked or expired requests cannot be claimed',async t=>{
  const {sqlite,db,bucket}=fixture(t);
  const share=await createSigningRequest(db,bucket,'user:test',fakeSnapshot(),1,now);
  assert.throws(()=>sqlite.exec("UPDATE quote_signing_requests SET status='submitting',submission_key='x',submitted_at=1"),/CHECK constraint/);
  const claim=sqlite.prepare(SIGNING_SQL.claim);
  const args={'?1':await signingSha256(share.token),'?2':share.expiresAt,'?3':'x','?4':'a'.repeat(64),'?5':'b'.repeat(64)};
  assert.equal(claim.get(args),undefined);
  await revokeSigningRequest(db,'user:test',share.id,now);
  assert.equal(claim.get({...args,'?2':now}),undefined);
  assert.throws(()=>sqlite.exec('UPDATE quote_signing_requests SET revoked_at=NULL'),/invalid signing transition/);
});

test('creation validates limits and keeps the private snapshot on an uncertain D1 failure',async t=>{
  const {db,bucket,objects}=fixture(t);
  for(const days of [0,31,1.5]) await assert.rejects(createSigningRequest(db,bucket,'user:test',fakeSnapshot(),days,now),/期限/);
  await assert.rejects(createSigningRequest(db,bucket,'',fakeSnapshot(),14,now),/工作區/);
  assert.equal(objects.size,0);
  await assert.rejects(createSigningRequest(db,bucket,'user:test',{tooLarge:'x'.repeat(20*1024*1024)},14,now),error=>error.status===413);
  const circular={};circular.self=circular;
  await assert.rejects(createSigningRequest(db,bucket,'user:test',circular,14,now),/序列化/);
  assert.equal(objects.size,0);
  const brokenDb={prepare(){return {bind(){return {async run(){throw new Error('uncertain D1 commit');}};}};}};
  await assert.rejects(createSigningRequest(brokenDb,bucket,'user:test',fakeSnapshot(),14,now),/uncertain D1 commit/);
  assert.equal(objects.size,1,'do not delete a snapshot if D1 might have committed');
});

test('separate shares get independent tokens and failed conditional R2 writes never create a DB row',async t=>{
  const {sqlite,db,bucket}=fixture(t);
  const a=await createSigningRequest(db,bucket,'user:test',fakeSnapshot(),14,now);
  const b=await createSigningRequest(db,bucket,'user:test',fakeSnapshot(),14,now);
  assert.notEqual(a.token,b.token);
  assert.notEqual(a.id,b.id);
  assert.equal(await revokeSigningRequest(db,'user:test',a.id,now),true);
  assert.equal((await loadSigningSnapshot(db,bucket,b.token,now)).status,'pending');
  await assert.rejects(createSigningRequest(db,{async put(){return null;}},'user:test',fakeSnapshot(),14,now),error=>error.status===409);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM quote_signing_requests').get().n,2);
});
