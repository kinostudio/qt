import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloud-sync/src/index.js';
import {SigningError} from '../cloud-sync/src/signing-store.js';

const origin='https://qt.kinostudio.tw';
const token='isolated-google-session-not-a-real-token';
test('worker preserves render retry timing in JSON and HTTP headers',async()=>{
  const env={ALLOWED_ORIGINS:origin,DB:{prepare(){return{bind(){return this;},async first(){throw new SigningError('請等待 22 秒後重試',429,22);}};}}};
  const response=await worker.fetch(new Request('https://api.test/api/onedrive',{headers:{Origin:origin,Authorization:'Bearer '+token}}),env);
  assert.equal(response.status,429);
  assert.equal(response.headers.get('retry-after'),'22');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{error:'請等待 22 秒後重試',retryAfter:22});
});
function environment(authenticated=false) {
  const writes=[];
  return {ALLOWED_ORIGINS:origin,writes,DB:{prepare(sql){
    const statement={bind(){return statement;},async first(){
      assert.match(sql,/cloud_sessions/,'disabled or unauthenticated routes must not read binding tables');
      return authenticated?{user_id:'isolated-user',email:'owner@example.invalid',expires_at:'2099-01-01T00:00:00Z'}:null;
    },async run(){writes.push(sql);throw Error('Unexpected write');}};
    return statement;
  }}};
}

test('OneDrive binding API rejects every unauthenticated operation without writes',async()=>{
  for(const [method,path] of [['GET',''],['DELETE',''],['POST','/start'],['POST','/complete'],['GET','/folders'],['POST','/folder'],['POST','/save']]) {
    const env=environment();
    const response=await worker.fetch(new Request('https://api.test/api/onedrive'+path,{method,headers:{Origin:origin,Authorization:'Bearer '+token}}),env);
    assert.equal(response.status,401,path);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(env.writes,[]);
  }
});

test('OneDrive binding remains disabled until explicitly configured and never publishes secrets',async()=>{
  const env=environment(true);
  env.MICROSOFT_CLIENT_SECRET='test-value-must-not-be-returned';
  env.ONEDRIVE_TOKEN_KEY='test-key-must-not-be-returned';
  const config=await worker.fetch(new Request('https://api.test/api/config',{headers:{Origin:origin}}),env);
  const configText=await config.text();
  assert.equal(JSON.parse(configText).oneDriveBindingEnabled,false);
  assert.ok(!configText.includes(env.MICROSOFT_CLIENT_SECRET));
  assert.ok(!configText.includes(env.ONEDRIVE_TOKEN_KEY));
  const response=await worker.fetch(new Request('https://api.test/api/onedrive',{headers:{Origin:origin,Authorization:'Bearer '+token}}),env);
  assert.equal(response.status,404);
  assert.deepEqual(env.writes,[]);
});

test('non-editor origin cannot access editor OneDrive binding API',async()=>{
  const env=environment(true);
  const response=await worker.fetch(new Request('https://api.test/api/onedrive',{headers:{Origin:'https://quote.kinostudio.tw',Authorization:'Bearer '+token}}),env);
  assert.equal(response.status,403);
  assert.deepEqual(env.writes,[]);
});
