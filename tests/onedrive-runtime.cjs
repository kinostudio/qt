// Actual workerd/D1, temporary bindings only. Never exchanges a Microsoft code.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {createHash}=require('node:crypto');
const {Miniflare,convertV4MiniflareOptions}=createRequire(path.resolve('cloud-sync/package.json'))('miniflare');

(async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({
    modules:true,scriptPath:path.resolve('tmp/onedrive-worker-bundle/index.js'),
    compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],cf:false,
    bindings:{ALLOWED_ORIGINS:'https://qt.kinostudio.tw',ONEDRIVE_BINDING_ENABLED:'true',
      MICROSOFT_CLIENT_ID:'isolated-client',MICROSOFT_CLIENT_SECRET:'isolated-test-not-real-secret',
      ONEDRIVE_TOKEN_KEY:'A'.repeat(43),ONEDRIVE_REDIRECT_URI:'https://qt.kinostudio.tw/onedrive-link.html'},
    d1Databases:['DB'],d1Persist:false,
  }));
  try {
    const db=await mf.getD1Database('DB');
    for(const statement of fs.readFileSync('cloud-sync/migrations/0010_onedrive_binding.sql','utf8').split(/(?<=;)\s*(?=CREATE)/)) await db.prepare(statement).run();
    await db.prepare('CREATE TABLE cloud_users(id TEXT PRIMARY KEY,email TEXT,display_name TEXT,picture_url TEXT)').run();
    await db.prepare('CREATE TABLE cloud_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at TEXT)').run();
    await db.prepare('CREATE TABLE cloud_projects(id TEXT PRIMARY KEY,data_json TEXT)').run();
    await db.prepare("INSERT INTO cloud_projects VALUES('sentinel','must-not-change')").run();
    const headers={Origin:'https://qt.kinostudio.tw','Content-Type':'application/json'};
    for(const user of ['A','B']) {
      await db.prepare('INSERT INTO cloud_users VALUES(?1,?2,?3,?4)').bind(user,user+'@example.invalid',user,'').run();
      await db.prepare('INSERT INTO cloud_sessions VALUES(?1,?2,?3)').bind(createHash('sha256').update('isolated-session-'+user+'-0123456789').digest('hex'),user,'2099-01-01T00:00:00Z').run();
    }
    const request=(user,suffix='',method='GET',body)=>mf.dispatchFetch('https://api.test/api/onedrive'+suffix,{
      method,headers:{...headers,Authorization:'Bearer isolated-session-'+user+'-0123456789'},body:body?JSON.stringify(body):undefined});
    const config=await(await mf.dispatchFetch('https://api.test/api/config',{headers})).json();
    assert.equal(config.oneDriveBindingEnabled,true);
    assert.deepEqual(await(await request('A')).json(),{bound:false});
    const verifier='v'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
    const started=await request('A','/start','POST',{challenge});
    assert.equal(started.status,200,await started.clone().text());
    const result=await started.json(),authorization=new URL(result.authorizationUrl);
    assert.equal(result.state,authorization.searchParams.get('state'));
    assert.equal(authorization.searchParams.get('code_challenge'),challenge);
    assert.equal(authorization.searchParams.get('redirect_uri'),'https://qt.kinostudio.tw/onedrive-link.html');
    assert.equal((await request('B','/complete','POST',{state:result.state,code:'unused-code',verifier})).status,400);
    assert.equal((await request('A','/complete','POST',{state:result.state,code:'unused-code',verifier:'x'.repeat(43)})).status,400);
    const stored=await db.prepare('SELECT * FROM onedrive_binding_attempts WHERE workspace_id=?1').bind('user:A').first();
    assert.equal(stored.consumed,0,'wrong owner or PKCE must not consume valid attempt');
    assert.ok(!JSON.stringify(stored).includes(result.state),'D1 must store state digest only');
    assert.equal((await request('A','','DELETE')).status,200);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM onedrive_binding_attempts').first('n'),0);
    assert.equal(await db.prepare('SELECT count(*) AS n FROM onedrive_bindings').first('n'),0);
    assert.equal(await db.prepare("SELECT data_json FROM cloud_projects WHERE id='sentinel'").first('data_json'),'must-not-change');
    console.log('PASS actual workerd/D1 binding config, state, PKCE, owner isolation, unlink and existing-data sentinel; no Microsoft requests');
  } finally {await mf.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
