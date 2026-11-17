import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const sandbox={window:{},crypto:webcrypto,TextEncoder};
vm.runInNewContext(await fs.readFile('assets/local-backup.js','utf8'),sandbox);
const api=sandbox.window.KinoLocalBackup;
const prefix='kino_quotation_';
class Storage {
  constructor(entries={}){this.entries=new Map(Object.entries(entries));}
  getItem(k){return this.entries.has(k)?this.entries.get(k):null;}
  setItem(k,v){if(this.failOnce===k){this.failOnce=null;throw Error('QuotaExceededError');}this.entries.set(k,v);}
  removeItem(k){this.entries.delete(k);}
}
const fixture=()=>new Storage({
  [prefix+'draft_v2']:JSON.stringify({header:{quotationId:'測試'},project:[],categories:[],notes:[],items:{},signature:{}}),
  [prefix+'project_library_v1']:JSON.stringify([{id:'project-test',name:'測試專案',data:{header:{}}}]),
  [prefix+'clause_library_v1']:JSON.stringify([{id:'clause-test',category:'測試分類',text:'保留原順序'}]),
  [prefix+'stamp_assets_v1']:JSON.stringify([{id:'stamp-test',dataUrl:'data:image/png;base64,fixture'}]),
  [prefix+'onedrive_autosave_v1']:'true',
  [prefix+'cloud_auth_token']:'must-not-export',
  [prefix+'cloud_sync_key']:'must-not-export-either',
  unrelated:'keep'
});
test('full local backup keeps exact data, counts and images but excludes auth and unrelated keys',async()=>{
  const source=fixture(),backup=await api.create(source,'https://old.test');
  assert.equal(Object.keys(backup.entries).length,5);
  assert.ok(!JSON.stringify(backup).includes('must-not-export'));
  const checked=await api.inspect(JSON.stringify(backup));
  assert.equal(checked.counts.projects,1);assert.equal(checked.counts.clauses,1);assert.equal(checked.counts.stamps,1);
  assert.equal(backup.entries[prefix+'draft_v2'],source.getItem(prefix+'draft_v2'));
});
test('restore only touches allowlisted local keys, preserves credentials, disables autosave and checks current data',async()=>{
  const backup=await api.create(fixture(),'https://old.test');
  const target=new Storage({[prefix+'draft_v2']:'{}',unrelated:'keep',[prefix+'cloud_auth_token']:'existing-token'});
  const receipt=await api.create(target,'https://new.test');
  await api.restore(target,JSON.stringify(backup),receipt.checksum);
  assert.equal(target.getItem(prefix+'draft_v2'),backup.entries[prefix+'draft_v2']);
  assert.equal(target.getItem(prefix+'onedrive_autosave_v1'),'false');
  assert.equal(target.getItem(prefix+'cloud_auth_token'),'existing-token');
  assert.equal(target.getItem('unrelated'),'keep');
  await assert.rejects(api.restore(target,JSON.stringify(backup),receipt.checksum),/已變更/);
});
test('tampering, credentials, incomplete stamp images and malformed data are rejected before restore',async()=>{
  const backup=await api.create(fixture(),'https://old.test');
  const changed=JSON.parse(JSON.stringify(backup));changed.entries[prefix+'draft_v2']='{}';
  await assert.rejects(api.inspect(JSON.stringify(changed)),/檢查碼/);
  const secret=JSON.parse(JSON.stringify(backup));secret.entries[prefix+'cloud_auth_token']='"secret"';
  await assert.rejects(api.inspect(JSON.stringify(secret)),/不支援/);
  const broken=fixture();broken.setItem(prefix+'draft_v2','{"items":[]}');
  await assert.rejects(api.create(broken,'https://old.test'),/格式錯誤/);
  const missing=fixture();missing.setItem(prefix+'stamp_assets_v1','[{"id":"stamp-test","versionId":"remote-only"}]');
  await assert.rejects(api.create(missing,'https://old.test'),/尚未下載/);
});
test('quota failure rolls back all local data',async()=>{
  const source=await api.create(fixture(),'https://old.test');
  const target=new Storage({[prefix+'draft_v2']:'{}',[prefix+'project_library_v1']:'[]',unrelated:'keep'});
  const before=Object.fromEntries(target.entries), receipt=await api.create(target,'https://new.test');
  target.failOnce=prefix+'stamp_assets_v1';
  await assert.rejects(api.restore(target,JSON.stringify(source),receipt.checksum),/已回復/);
  assert.deepEqual(Object.fromEntries(target.entries),before);
});
