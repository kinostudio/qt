// Real workerd fetch/Request semantics; outbound service is a closed local double.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {createHash}=require('node:crypto');
const {Miniflare,convertV4MiniflareOptions}=createRequire(path.resolve('cloud-sync/package.json'))('miniflare');
(async()=>{
  const source=fs.readFileSync('cloud-sync/src/onedrive-binding.js','utf8').replace(/^export /gm,'');
  let mode='success';const outbound=[];
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,cf:false,
    compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],
    script:source+`\nexport default {async fetch(request,env){try{return await handleOneDriveBinding(request,env,{type:'google',workspaceId:'user:isolated-runtime'});}catch(error){return Response.json({error:error.message,code:error.code},{status:error.status||500});}}};`,
    bindings:{ONEDRIVE_BINDING_ENABLED:'true',MICROSOFT_CLIENT_ID:'isolated-client',MICROSOFT_CLIENT_SECRET:'isolated-dummy-secret',
      ONEDRIVE_TOKEN_KEY:'A'.repeat(43),ONEDRIVE_REDIRECT_URI:'https://qt.kinostudio.tw/onedrive-link.html'},
    d1Databases:['DB'],d1Persist:false,
    outboundService:async request=>{
      const url=new URL(request.url);outbound.push(url.origin+url.pathname);
      assert.ok(['https://login.microsoftonline.com','https://graph.microsoft.com'].includes(url.origin),'credentials must never follow a redirect');
      if(url.origin==='https://login.microsoftonline.com'){
        assert.equal(request.method,'POST');
        const body=new URLSearchParams(await request.text());
        assert.equal(body.get('client_secret'),'isolated-dummy-secret');
        if(mode==='token-redirect')return new Response(null,{status:302,headers:{location:'https://attacker.invalid/token'}});
        return Response.json({access_token:'isolated-access-token',refresh_token:'isolated-refresh-token'});
      }
      assert.equal(request.headers.get('authorization'),'Bearer isolated-access-token');
      if(mode==='graph-redirect')return new Response(null,{status:307,headers:{location:'https://attacker.invalid/drive'}});
      if(url.pathname==='/v1.0/me/drive')return Response.json({id:'drive!isolated',owner:{user:{displayName:'Isolated'}}});
      if(url.pathname.endsWith('/children'))return Response.json({value:[]});
      return Response.json({id:'root',name:'OneDrive',root:{},folder:{},parentReference:{driveId:'drive!isolated'}});
    }
  }));
  try{
    const db=await mf.getD1Database('DB');
    for(const statement of fs.readFileSync('cloud-sync/migrations/0010_onedrive_binding.sql','utf8').split(/(?<=;)\s*(?=CREATE)/))await db.prepare(statement).run();
    const call=(suffix,body)=>mf.dispatchFetch('https://isolated.test/api/onedrive'+suffix,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});
    const verifier='v'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
    const complete=async()=>{const start=await(await call('/start',{challenge})).json();return call('/complete',{state:start.state,code:'isolated-code',verifier});};
    const linked=await complete();
    assert.equal(linked.status,200,await linked.clone().text());
    assert.equal((await linked.json()).bound,true);
    assert.equal(outbound.length,2,'real fetch must reach token and Graph doubles');
    const folders=await call('/folders?folderId=root');
    assert.equal(folders.status,200,await folders.clone().text());
    assert.deepEqual((await folders.json()).value,[]);
    const revision=(await(await call('')).json()).revision;
    for(const redirectMode of ['token-redirect','graph-redirect']){
      mode=redirectMode;const before=outbound.length;
      const rejected=await complete();
      assert.equal(rejected.status,502);
      assert.equal((await rejected.json()).code,'ONEDRIVE_REDIRECT_REJECTED');
      assert.equal(outbound.length-before,redirectMode==='token-redirect'?1:2,'redirect must stop without a second destination');
      assert.equal((await(await call('')).json()).revision,revision,'failed rebind must preserve existing binding');
    }
    console.log('PASS actual workerd token exchange, Graph lookup, refresh and 3xx rejection; zero real Microsoft or production storage calls');
  }finally{await mf.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
