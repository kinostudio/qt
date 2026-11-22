import {SigningError,createSigningRequest,loadSigningSnapshot,loadSigningSnapshotForOwner,revokeSigningRequest,listSigningRequests} from './signing-store.js';
import {readSigningJson,validateSigningCreate,rasterizeSigningImages} from './signing-validation.js';
import {loadSignedPdfForGuest,loadSignedPdfForOwner,submitSigningRequest} from './signing-submit.js';
import {createSigningRenderSession} from './signing-browser.js';
import {loadSigningPreview,previewSigningSubmission} from './signing-preview.js';
import {createBudgetBrowserSession} from './browser-budget.js';
import {prepareOwnerSigning,loadOwnerPrepared} from './signing-prepared.js';

export const isSigningGuestPath=path=>['/api/signing/guest','/api/signing/guest/pdf','/api/signing/guest/preview'].includes(path);

const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff'
}});

function pdfReply(file,quotationId) {
  const filename=String(quotationId||'quotation').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,180)+'.pdf';
  return new Response(file.bytes,{headers:{'content-type':'application/pdf','cache-control':'no-store',
    'content-disposition':`attachment; filename="quotation.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff',
    'x-content-sha256':file.sha256,'access-control-expose-headers':'x-content-sha256'}});
}

async function decodeImagesUsingBrowser(env,snapshot) {
  const q=snapshot.quotation;
  if(!q.logo && !q.signature.clientSigImg && !q.signature.vendorSigImg && !q.signature.clientStamp.sourceDataUrl && !q.signature.vendorStamp.sourceDataUrl) return snapshot;
  if(!env.PDF_BROWSER) throw new SigningError('圖片驗證服務尚未啟用',503);
  const budget=createBudgetBrowserSession(env);
  try {
    const browser=await budget.browser();
    return await rasterizeSigningImages(await browser.newPage(),snapshot);
  } catch(error) {
    if(error instanceof SigningError)throw error;
    throw new SigningError('圖片無法解析或驗證服務暫時無法使用，尚未建立待簽版本',503);
  } finally {
    await budget.close();
  }
}

export async function handleSigningGuest(request,env,createSession=createSigningRenderSession) {
  const header=request.headers.get('authorization')||'';
  const token=header.startsWith('Quote ')?header.slice(6):'';
  const path=new URL(request.url).pathname;
  const allowRender=async()=>{
    if(!env.PDF_RATE_LIMITER) throw new SigningError('簽署用量保護尚未設定',503);
    return (await env.PDF_RATE_LIMITER.limit({key:'signing:documents'})).success;
  };
  if(request.method==='POST' && ['/api/signing/guest','/api/signing/guest/preview'].includes(path)) {
    if(env.SIGNING_SUBMIT_ENABLED!=='true') throw new SigningError('客戶簽署送出尚未開放',503);
    const session=createSession(env);
    try {
      const body=await readSigningJson(request);
      if(path==='/api/signing/guest/preview') {
        const file=await previewSigningSubmission(env.DB,env.STAMP_BUCKET,token,body,{...session,allowRender});
        return pdfReply(file,file.quotationId);
      }
      const result=await submitSigningRequest(env.DB,env.STAMP_BUCKET,token,body,{...session,allowRender});
      return reply(result,result.status==='signed'?200:202);
    } finally {await session.close();}
  }
  if(request.method!=='GET') throw new SigningError('不支援此操作',405);
  if(path==='/api/signing/guest/preview') {
    const session=createSession(env);
    try {const file=await loadSigningPreview(env.DB,env.STAMP_BUCKET,token,{...session,allowRender});return pdfReply(file,file.quotationId);}
    finally {await session.close();}
  }
  if(new URL(request.url).pathname==='/api/signing/guest/pdf') {
    const file=await loadSignedPdfForGuest(env.DB,env.STAMP_BUCKET,token);
    const fixed=await loadSigningSnapshot(env.DB,env.STAMP_BUCKET,token);
    return pdfReply(file,fixed.snapshot.quotation.header.quotationId);
  }
  const fixed=await loadSigningSnapshot(env.DB,env.STAMP_BUCKET,token);
  const {printDocument,...visible}=fixed.snapshot;
  return reply({...fixed,snapshot:visible,canSubmit:env.SIGNING_SUBMIT_ENABLED==='true'});
}

export async function handleSigningOwner(request,env,auth,decodeImages=decodeImagesUsingBrowser,createSession=createSigningRenderSession) {
  const allowed=String(env.SIGNING_ALLOWED_EMAILS||'').split(',').map(email=>email.trim().toLowerCase()).filter(Boolean);
  if(auth?.type!=='google' || !allowed.includes(String(auth.user?.email||'').toLowerCase())) throw new SigningError('此帳號尚未開通客戶簽署',403);
  const path=new URL(request.url).pathname;
  if(path==='/api/signing/prepare'&&request.method==='POST') {
    const body=await readSigningJson(request);
    if(!body||Object.keys(body).length!==1||!body.snapshot)throw new SigningError('固定版本格式不正確');
    const {snapshot}=validateSigningCreate({confirmed:true,snapshot:body.snapshot});
    if(!env.PDF_RATE_LIMITER)throw new SigningError('簽署用量保護尚未設定',503);
    if(!(await env.PDF_RATE_LIMITER.limit({key:auth.user.id})).success)throw new SigningError('操作過於頻繁，請稍後重試',429);
    const session=createSession(env);
    try {return reply(await prepareOwnerSigning(env.STAMP_BUCKET,auth.workspaceId,snapshot,session),201);}
    finally {await session.close();}
  }
  const prepared=/^\/api\/signing\/prepared\/([a-f0-9-]{36})\/pdf$/.exec(path);
  if(prepared&&request.method==='GET') {
    const fixed=await loadOwnerPrepared(env.STAMP_BUCKET,auth.workspaceId,prepared[1]);
    return pdfReply(fixed.pdf,fixed.snapshot.quotation.header.quotationId);
  }
  if(path==='/api/signing' && request.method==='GET') {
    const offset=new URL(request.url).searchParams.get('offset')||'0';
    if(!/^\d{1,6}$/.test(offset))throw new SigningError('簽署清單頁碼不正確');
    return reply(await listSigningRequests(env.DB,auth.workspaceId,Number(offset)));
  }
  if(path==='/api/signing' && request.method==='POST') {
    if(!env.SIGNING_LINK_SECRET)throw new SigningError('簽署連結金鑰尚未設定',503);
    const {snapshot,lifetimeDays,preparedId}=validateSigningCreate(await readSigningJson(request));
    if(preparedId) {
      if(!env.PDF_RATE_LIMITER)throw new SigningError('簽署用量保護尚未設定',503);
      if(!(await env.PDF_RATE_LIMITER.limit({key:'signing:create:'+auth.user.id})).success)throw new SigningError('連結建立過於頻繁，請稍後重試',429);
      const fixed=await loadOwnerPrepared(env.STAMP_BUCKET,auth.workspaceId,preparedId);
      const share=await createSigningRequest(env.DB,env.STAMP_BUCKET,auth.workspaceId,fixed.snapshot,lifetimeDays,Date.now(),env.SIGNING_LINK_SECRET,fixed.pdf);
      return reply({...share,url:`https://quote.kinostudio.tw/s/${share.token}`},201);
    }
    if(!env.PDF_RATE_LIMITER) throw new SigningError('簽署用量保護尚未設定',503);
    const limit=await env.PDF_RATE_LIMITER.limit({key:auth.user.id});
    if(!limit.success) throw new SigningError('操作過於頻繁，請稍後重試',429);
    const fixedSnapshot=await decodeImages(env,snapshot);
    const share=await createSigningRequest(env.DB,env.STAMP_BUCKET,auth.workspaceId,fixedSnapshot,lifetimeDays,Date.now(),env.SIGNING_LINK_SECRET);
    return reply({...share,url:`https://quote.kinostudio.tw/s/${share.token}`},201);
  }
  const match=/^\/api\/signing\/([a-f0-9-]{36})(\/pdf)?$/.exec(path);
  if(!match) throw new SigningError('找不到簽署操作',404);
  const id=match[1];
  if(match[2]) {
    if(request.method!=='GET') throw new SigningError('不支援此操作',405);
    const file=await loadSignedPdfForOwner(env.DB,env.STAMP_BUCKET,auth.workspaceId,id);
    const fixed=await loadSigningSnapshotForOwner(env.DB,env.STAMP_BUCKET,auth.workspaceId,id);
    return pdfReply(file,fixed.snapshot.quotation.header.quotationId);
  }
  if(request.method==='GET') return reply(await loadSigningSnapshotForOwner(env.DB,env.STAMP_BUCKET,auth.workspaceId,id,env.SIGNING_LINK_SECRET));
  if(request.method==='DELETE') {
    if(!await revokeSigningRequest(env.DB,auth.workspaceId,id)) throw new SigningError('找不到可撤銷的待簽版本',404);
    return reply({ok:true});
  }
  throw new SigningError('不支援此操作',405);
}
