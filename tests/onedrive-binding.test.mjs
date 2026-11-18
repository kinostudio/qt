import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {handleOneDriveBinding, isOneDriveBindingEnabled, OneDriveBindingError} from '../cloud-sync/src/onedrive-binding.js';

const migration = await readFile(new URL('../cloud-sync/migrations/0010_onedrive_binding.sql', import.meta.url), 'utf8');
const verifier = 'test-verifier-'.repeat(5);
const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
const auth = {type: 'google', workspaceId: 'user:owner'};
const other = {type: 'google', workspaceId: 'user:other'};
const json = (data, status = 200) => Response.json(data, {status});
const folder = (id = 'root', name = 'Documents') => ({id, name, folder: {}, ...(id === 'root' ? {root: {}} : {}), parentReference: {driveId: 'drive!own', path: '/drives/drive!own/root:'}});

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  t.after(() => sqlite.close());
  const wrap = (query, values) => {
    const args = Object.fromEntries(values.map((value, i) => ['?'+(i+1),value]));
    return {
      async first() {return sqlite.prepare(query).get(args) || null;},
      async run() {return {meta: {changes: Number(sqlite.prepare(query).run(args).changes)}};},
    };
  };
  const db = {prepare(query) {return {bind(...values) {return wrap(query, values);}};}, async batch(statements) {
    sqlite.exec('BEGIN');
    try {const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results;}
    catch (error) {sqlite.exec('ROLLBACK'); throw error;}
  }};
  const env = {DB: db, ONEDRIVE_BINDING_ENABLED: 'true', MICROSOFT_CLIENT_ID: 'test-client', MICROSOFT_CLIENT_SECRET: 'test-secret',
    ONEDRIVE_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64url'), ONEDRIVE_REDIRECT_URI: 'https://qt.kinostudio.tw/onedrive-link.html'};
  const calls = [];
  let override;
  const fetchFn = async (url, options) => {
    calls.push({url: String(url), options});
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    if (override) {const result = await override(String(url), options); if (result) return result;}
    if (String(url).includes('/token')) return json({access_token: 'access-test-secret', refresh_token: 'refresh-test-secret'});
    if (String(url).includes('/me/drive')) return json({id: 'drive!own', owner: {user: {displayName: 'Test Owner', email: 'owner@example.test'}}});
    if (String(url).endsWith(':/content')) return json({id: 'file!saved'});
    if (String(url).includes('/children')) return json({value: [folder('child'), {id:'file',name:'ignore',file:{}}, {...folder('remote'),remoteItem:{}}, {...folder('foreign'),parentReference:{driveId:'other'}}]});
    if (new URL(url).pathname.includes(':/')) return json({error: {code:'itemNotFound'}},404);
    return json(folder(String(url).endsWith('/root') ? 'root' : 'chosen'));
  };
  const call = (path = '', method = 'GET', body, who = auth) => handleOneDriveBinding(new Request('https://api.example.test/api/onedrive'+path,
    {method, ...(body === undefined ? {} : {body: JSON.stringify(body), headers: {'content-type':'application/json'}})}), env, who, fetchFn);
  const row = () => sqlite.prepare('SELECT * FROM onedrive_bindings WHERE workspace_id=?').get(auth.workspaceId);
  const begin = async () => (await call('/start', 'POST', {challenge})).json();
  const bind = async () => {const {state} = await begin(); return (await call('/complete','POST',{state,code:'test-code',verifier})).json();};
  const select = async (auto = false) => {const current = row(); return (await call('/folder','POST',{folderId:'root',autoCreateProjectFolder:auto,revision:current.revision})).json();};
  const saveBody = (id = '260729 Film_KS01') => ({quotationId:id,quotation:{header:{quotationId:id},current:'latest'},revision:row().revision});
  return {sqlite, env, calls, call, row, begin, bind, select, saveBody, setFetch(fn) {override = fn;}};
}
const rejects = (promise, status, code) => assert.rejects(promise, error => error instanceof OneDriveBindingError && error.status === status && (code === undefined || error.code === code));

test('gate is fail-closed and error constructor follows ApiError ordering', async t => {
  const f = fixture(t);
  assert.equal(new OneDriveBindingError('message').status,400);
  assert.equal(new OneDriveBindingError('message',409,'CODE').code,'CODE');
  assert.equal(isOneDriveBindingEnabled(f.env),true);
  for (const [key, value] of [['ONEDRIVE_BINDING_ENABLED',undefined],['MICROSOFT_CLIENT_SECRET',''],['MICROSOFT_CLIENT_ID',''],['ONEDRIVE_TOKEN_KEY','x'.repeat(43)],['ONEDRIVE_REDIRECT_URI','https://attacker.test/']]) {
    assert.equal(isOneDriveBindingEnabled({...f.env,[key]:value}),false);
  }
  await rejects(f.call('', 'GET', undefined, null),401);
  await rejects(f.call('', 'GET', undefined, {type:'legacy',workspaceId:'user:owner'}),401);
  assert.deepEqual(await (await f.call()).json(),{bound:false});
});

test('PKCE confidential WEB authorization, hashed one-use state and encrypted workspace AAD credentials', async t => {
  const f = fixture(t);
  const started = await f.begin();
  const url = new URL(started.authorizationUrl);
  assert.equal(url.searchParams.get('state'),started.state);
  assert.equal(Buffer.from(started.state,'base64url').length,32);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('scope'),'offline_access https://graph.microsoft.com/Files.ReadWrite');
  assert.equal(url.searchParams.get('redirect_uri'),f.env.ONEDRIVE_REDIRECT_URI);
  const attempt = f.sqlite.prepare('SELECT * FROM onedrive_binding_attempts').get();
  assert.notEqual(attempt.state_hash,started.state);
  assert.ok(attempt.expires_at > Date.now()+590000);
  await rejects(f.call('/complete','POST',{state:started.state,code:'code',verifier},other),400);
  await rejects(f.call('/complete','POST',{state:started.state,code:'code',verifier:'wrong'.repeat(12)}),400);
  assert.equal(f.calls.length,0);
  const bound = await (await f.call('/complete','POST',{state:started.state,code:'code',verifier})).json();
  assert.equal(bound.account.homeAccountId,'drive!own');
  assert.equal(bound.account.username,'owner@example.test');
  assert.equal(bound.needsReconnect,false);
  assert.equal(bound.folder,null);
  assert.equal((await (await f.call()).json()).revision,bound.revision);
  const tokenBody = new URLSearchParams(f.calls[0].options.body);
  assert.equal(tokenBody.get('client_secret'),'test-secret');
  assert.equal(tokenBody.get('code_verifier'),verifier);
  assert.equal(tokenBody.get('grant_type'),'authorization_code');
  assert.ok(!JSON.stringify(bound).includes('secret'));
  assert.ok(!f.row().refresh_encrypted.includes('refresh-test-secret'));
  const [iv,cipher] = f.row().refresh_encrypted.split('.').map(value => Buffer.from(value,'base64url'));
  const key = await crypto.subtle.importKey('raw',Buffer.from(f.env.ONEDRIVE_TOKEN_KEY,'base64url'),'AES-GCM',false,['decrypt']);
  assert.equal(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(auth.workspaceId)},key,cipher)),'refresh-test-secret');
  await assert.rejects(crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(other.workspaceId)},key,cipher));
  await rejects(f.call('/complete','POST',{state:started.state,code:'code',verifier}),400);
});

test('expired and concurrently replayed state cannot exchange twice', async t => {
  const f = fixture(t);
  const expired = await f.begin();
  f.sqlite.exec('UPDATE onedrive_binding_attempts SET expires_at=0');
  await rejects(f.call('/complete','POST',{state:expired.state,code:'code',verifier}),400);
  const started = await f.begin();
  const results = await Promise.allSettled([1,2].map(() => f.call('/complete','POST',{state:started.state,code:'code',verifier})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.calls.filter(c=>c.url.includes('/token')).length,1);
});

test('tampering ciphertext fails closed, and rotation is persisted before Graph without changing revision', async t => {
  const f = fixture(t);
  await f.bind();
  const original = f.row();
  f.sqlite.prepare('UPDATE onedrive_bindings SET refresh_encrypted=?').run(original.refresh_encrypted.slice(0,-5)+'AAAAA');
  await rejects(f.call('/folders'),503);
  assert.equal(f.row().lease_id,null);
  f.sqlite.prepare('UPDATE onedrive_bindings SET refresh_encrypted=?').run(original.refresh_encrypted);
  f.setFetch((url, options) => {
    if (url.includes('/token')) {
      assert.equal(new URLSearchParams(options.body).get('refresh_token'),'refresh-test-secret');
      return json({access_token:'rotated-access',refresh_token:'rotated-refresh'});
    }
    assert.notEqual(f.row().refresh_encrypted,original.refresh_encrypted);
    assert.equal(f.row().revision,original.revision);
  });
  const listed = await (await f.call('/folders')).json();
  assert.equal(listed.value.length,1);
  assert.deepEqual(listed.value[0].folder,{});
  assert.equal(listed.nextCursor,null);
  f.setFetch((url, options) => {
    if (url.includes('/token')) {assert.equal(new URLSearchParams(options.body).get('refresh_token'),'rotated-refresh'); return json({access_token:'access-next'});}
  });
  await f.call('/folders');
});

test('invalid_grant and Graph 401 require Microsoft reconnect without Google logout status', async t => {
  const f = fixture(t);
  await f.bind();
  f.setFetch(url => url.includes('/token') ? json({error:'invalid_grant',error_description:'sensitive provider detail'},400) : undefined);
  await rejects(f.call('/folders'),409,'ONEDRIVE_REAUTH_REQUIRED');
  assert.equal((await (await f.call()).json()).needsReconnect,true);
  await rejects(f.call('/folders'),409,'ONEDRIVE_REAUTH_REQUIRED');
  f.setFetch(undefined);
  await f.bind();
  f.setFetch(url => url.includes('/drives/') ? json({error:{message:'secret'}},401) : undefined);
  await rejects(f.call('/folders'),409,'ONEDRIVE_REAUTH_REQUIRED');
});

test('live lease blocks concurrent Graph, unlink and rebind; expired lease is recoverable', async t => {
  const f = fixture(t);
  await f.bind();
  f.sqlite.prepare('UPDATE onedrive_bindings SET lease_id=?,lease_until=?').run('other-device',Date.now()+30000);
  await rejects(f.call('/folders'),409);
  await rejects(f.call('','DELETE'),409);
  await rejects(f.bind(),409);
  f.sqlite.exec('UPDATE onedrive_bindings SET lease_until=0');
  await f.call('/folders');
  assert.equal(f.row().lease_id,null);
});

test('folder selection rotates settings revision; save and folder require matching revision', async t => {
  const f = fixture(t);
  await f.bind();
  const before = f.row().revision;
  const selected = await f.select();
  assert.notEqual(selected.revision,before);
  assert.equal(selected.folder.id,'root');
  assert.equal(selected.folder.autoCreateProjectFolder,false);
  await rejects(f.call('/save','POST',{...f.saveBody(),revision:undefined}),409);
  await rejects(f.call('/save','POST',{...f.saveBody(),revision:before}),409);
  await rejects(f.call('/folder','POST',{folderId:'root',autoCreateProjectFolder:false}),409);
  await rejects(f.call('/folder','POST',{folderId:'root',autoCreateProjectFolder:false,revision:before}),409);
  assert.equal(f.row().revision,selected.revision);
});

test('save only current quotation and server-selected folder, new-file and existing-file conditional headers', async t => {
  const f = fixture(t);
  await f.bind();
  await rejects(f.call('/save','POST',f.saveBody()),409);
  await f.select();
  const body = {...f.saveBody(),folderId:'attacker-folder',access_token:'browser-untrusted'};
  const saved = await (await f.call('/save','POST',body)).json();
  assert.deepEqual(saved,{id:'file!saved',name:'260729 Film_KS01.json'});
  let put = f.calls.findLast(c=>c.options.method==='PUT');
  assert.ok(put.url.includes('/items/root:/260729%20Film_KS01.json:') || put.url.includes('/root:/260729%20Film_KS01.json:'));
  assert.ok(!put.url.includes('attacker-folder'));
  assert.deepEqual(JSON.parse(put.options.body),body.quotation);
  assert.equal(put.options.headers['If-None-Match'],'*');
  f.setFetch(url=>url.includes('.json') && !url.endsWith(':/content') ? json({id:'file!saved',eTag:'"v1"',parentReference:{driveId:'drive!own'}}) : undefined);
  await f.call('/save','POST',f.saveBody());
  put = f.calls.findLast(c=>c.options.method==='PUT');
  assert.equal(put.options.headers['If-Match'],'"v1"');
  for (const status of [409,412]) {
    const count = f.calls.filter(c=>c.options.method==='PUT').length;
    f.setFetch(url=>url.endsWith(':/content') ? json({error:{message:'conflict'}},status) : undefined);
    await rejects(f.call('/save','POST',f.saveBody()),status);
    assert.equal(f.calls.filter(c=>c.options.method==='PUT').length,count+1);
  }
});

test('save rejects mismatched IDs, non-objects, traversal, controls and provider-reserved names', async t => {
  const f = fixture(t);
  await f.bind(); await f.select();
  for (const id of ['../file','a/b','a\\b','a%2Fb','CON','NUL.txt','COM1','desktop.ini','_vti_bad','prefix_vti_file','forms','~$file','a\u0000b','a\u202eb','..','   ']) {
    await rejects(f.call('/save','POST',f.saveBody(id)),400);
  }
  await rejects(f.call('/save','POST',{...f.saveBody(),quotation:{header:{quotationId:'wrong'}}}),400);
  await rejects(f.call('/save','POST',{...f.saveBody(),quotation:[]}),400);
  assert.equal(f.calls.filter(c=>c.options.method==='PUT').length,0);
});

test('project folder uses existing KS suffix rule, fail-on-conflict create and reread', async t => {
  const f = fixture(t);
  await f.bind(); await f.select(true);
  let lookup = 0;
  f.setFetch((url, options) => {
    if (url.endsWith(':/260729%20Film')) return ++lookup===1 ? json({error:{}},404) : json(folder('project','260729 Film'));
    if (options.method==='POST' && url.endsWith('/children')) {
      assert.deepEqual(JSON.parse(options.body),{name:'260729 Film',folder:{},'@microsoft.graph.conflictBehavior':'fail'});
      return json({error:{}},409);
    }
  });
  await f.call('/save','POST',f.saveBody());
  assert.equal(lookup,2);
  assert.ok(f.calls.findLast(c=>c.options.method==='PUT').url.includes('/items/project:/'));
});

test('folder IDs/cursors cannot redirect credentials or use a different drive/folder', async t => {
  const f = fixture(t);
  await f.bind();
  for (const cursor of ['https://attacker.test/v1.0/drives/drive!own/root/children','https://graph.microsoft.com/v1.0/drives/other/root/children',
    'https://graph.microsoft.com/v1.0/drives/drive!own/items/other/children','https://user@graph.microsoft.com/v1.0/drives/drive!own/root/children',
    'https://graph.microsoft.com/v1.0/drives/drive!own/root/children?$expand=remoteItem','not-a-url']) {
    await rejects(f.call('/folders?cursor='+encodeURIComponent(cursor)),400);
  }
  await rejects(f.call('/folders?folderId='+encodeURIComponent('../me')),400);
  const cursor = 'https://graph.microsoft.com/v1.0/drives/drive!own/root/children?$skiptoken=opaque';
  f.setFetch(url=>url.includes('/children') ? json({value:[folder('child')],'@odata.nextLink':cursor}) : undefined);
  assert.equal((await (await f.call('/folders')).json()).nextCursor,cursor);
  await f.call('/folders?cursor='+encodeURIComponent(cursor));
  assert.equal(f.calls.at(-1).url,cursor);
  f.setFetch(url=>url.includes('/children') ? json({value:[],'@odata.nextLink':'https://attacker.test/'}) : undefined);
  await rejects(f.call('/folders'),502);
  f.setFetch(url=>url.includes('/children') ? json({value:[],'@odata.nextLink':'not-a-url'}) : undefined);
  await rejects(f.call('/folders'),502);
});

test('one live lease spans refresh and Graph while concurrent unlink and operations are refused', async t => {
  const f = fixture(t);
  await f.bind();
  let release;
  let reached;
  const barrier = new Promise(resolve=>{reached=resolve;});
  f.setFetch(async url=>{
    if (url.includes('/drives/') && !url.includes('/children')) {reached(); await new Promise(resolve=>{release=resolve;});}
  });
  const pending = f.call('/folders');
  await barrier;
  assert.ok(f.row().lease_until>Date.now());
  const refreshCount = f.calls.filter(c=>c.url.includes('/token')).length;
  await rejects(f.call('/folders'),409);
  assert.equal(f.calls.filter(c=>c.url.includes('/token')).length,refreshCount);
  await rejects(f.call('','DELETE'),409);
  release();
  await pending;
  assert.equal(f.row().lease_id,null);
});

test('rebind rotates revision, clears only folder settings and preserves unrelated project data', async t => {
  const f = fixture(t);
  f.sqlite.exec("CREATE TABLE cloud_projects(id TEXT); INSERT INTO cloud_projects VALUES('keep')");
  await f.bind(); await f.select();
  const old = f.row();
  const bound = await f.bind();
  assert.notEqual(bound.revision,old.revision);
  assert.equal(bound.folder,null);
  assert.equal(bound.needsReconnect,false);
  assert.notEqual(f.row().refresh_encrypted,old.refresh_encrypted);
  assert.equal(f.sqlite.prepare('SELECT id FROM cloud_projects').get().id,'keep');
});

test('remote/shared folder cannot be selected', async t => {
  const f = fixture(t);
  await f.bind();
  for (const item of [{...folder(),remoteItem:{}},{...folder(),parentReference:{driveId:'foreign'}},{id:'file',name:'file',file:{}}]) {
    f.setFetch(url=>url.includes('/drives/') ? json(item) : undefined);
    await rejects(f.select(),400);
  }
});

test('unlink deletes only binding and attempts, and fences an in-flight completion', async t => {
  const f = fixture(t);
  f.sqlite.exec("CREATE TABLE cloud_projects(id TEXT); INSERT INTO cloud_projects VALUES('keep')");
  await f.bind(); await f.begin();
  const calls = f.calls.length;
  assert.deepEqual(await (await f.call('','DELETE')).json(),{bound:false});
  assert.equal(f.calls.length,calls);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM onedrive_binding_attempts').get().n,0);
  assert.equal(f.sqlite.prepare('SELECT id FROM cloud_projects').get().id,'keep');
  const started = await f.begin();
  let release;
  let reached;
  const barrier = new Promise(resolve=>{reached=resolve;});
  f.setFetch(async url=>{
    if (url.includes('/token')) {reached(); await new Promise(resolve=>{release=resolve;});}
  });
  const pending = f.call('/complete','POST',{state:started.state,code:'code',verifier});
  await barrier;
  await f.call('','DELETE');
  release();
  await rejects(pending,409);
  assert.deepEqual(await (await f.call()).json(),{bound:false});
});

test('stale refresh cannot rotate or issue Graph after rebind/unlink or lease expiry', async t => {
  const f = fixture(t);
  await f.bind();
  const graphCalls = f.calls.filter(c=>c.url.includes('/drives/')).length;
  f.setFetch(url=> {
    if (url.includes('/token')) {
      f.sqlite.prepare('UPDATE onedrive_bindings SET revision=?,lease_id=NULL,lease_until=0').run('new-binding');
      return json({access_token:'stale-access',refresh_token:'stale-refresh'});
    }
  });
  await rejects(f.call('/folders'),409);
  assert.equal(f.row().revision,'new-binding');
  assert.equal(f.calls.filter(c=>c.url.includes('/drives/')).length,graphCalls);
  f.setFetch(url=>{if(url.includes('/token')) {f.sqlite.exec('UPDATE onedrive_bindings SET lease_until=0'); return json({access_token:'expired-access'});}});
  await rejects(f.call('/folders'),409);
});

test('bounded streamed request and external responses, generic provider failures', async t => {
  const f = fixture(t);
  const huge = 'x'.repeat(2*1024*1024+1);
  await rejects(f.call('/start','POST',{challenge,huge}),413);
  const request = new Request('https://api.example.test/api/onedrive/start',{method:'POST',duplex:'half',body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(huge));controller.close();}})});
  await rejects(handleOneDriveBinding(request,f.env,auth),413);
  await f.bind();
  f.setFetch(()=>new Response(huge));
  await rejects(f.call('/folders'),502);
  f.setFetch(()=>{throw new Error('sensitive-secret-provider-error');});
  await assert.rejects(f.call('/folders'),error=>error.status===502&&!error.message.includes('sensitive'));
});

test('provider redirects are rejected before parsing or forwarding credentials', async t => {
  const f=fixture(t);
  f.setFetch(()=>new Response(null,{status:302,headers:{location:'https://attacker.invalid/'}}));
  const {state}=await f.begin();
  await rejects(f.call('/complete','POST',{state,code:'test-code',verifier}),502,'ONEDRIVE_REDIRECT_REJECTED');
  assert.equal(f.calls.length,1);
  assert.equal(f.row(),undefined);
});

test('migration adds only new independent tables, preserves existing schema and project rows', async t => {
  const sqlite = new DatabaseSync(':memory:'); t.after(()=>sqlite.close());
  for (const file of (await readdir('cloud-sync/migrations')).filter(file=>file.endsWith('.sql')&&file<'0010').sort()) sqlite.exec(await readFile('cloud-sync/migrations/'+file,'utf8'));
  sqlite.exec("INSERT INTO cloud_projects(workspace_id,id,name,data_json,updated_at) VALUES('test-workspace','sentinel','KEEP','{}','2026-01-01')");
  const tables = sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const before = tables.map(table=>({table,rows:sqlite.prepare('SELECT * FROM "'+table.name+'"').all()}));
  sqlite.exec(migration);
  for (const {table,rows} of before) {
    assert.equal(sqlite.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table.name).sql,table.sql);
    assert.deepEqual(sqlite.prepare('SELECT * FROM "'+table.name+'"').all(),rows);
  }
  const source = await readFile('cloud-sync/src/index.js','utf8');
  assert.ok(!/SELECT\s+\*\s+FROM\s+onedrive_/i.test(source));
});
