import {SigningError,createSigningRequest,loadSigningSnapshot,loadSigningSnapshotForOwner,revokeSigningRequest} from './signing-store.js';
import {readSigningJson,validateSigningCreate,rasterizeSigningImages} from './signing-validation.js';
import {loadSignedPdfForGuest,loadSignedPdfForOwner,submitSigningRequest} from './signing-submit.js';
import {createSigningRenderSession} from './signing-browser.js';
import {loadSigningPreview,previewSigningSubmission} from './signing-preview.js';

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
  let browser;
  try {
    const {default:puppeteer}=await import('@cloudflare/puppeteer');
    browser=await puppeteer.launch(env.PDF_BROWSER,{keep_alive:10000});
    return await rasterizeSigningImages(await browser.newPage(),snapshot);
  } catch {
    throw new SigningError('圖片無法解析或驗證服務暫時無法使用，尚未建立待簽版本',503);
  } finally {
    if(browser) await browser.close().catch(()=>{});
  }
}

export async function handleSigningGuest(request,env) {
  const header=request.headers.get('authorization')||'';
  const token=header.startsWith('Quote ')?header.slice(6):'';
  const path=new URL(request.url).pathname;
  const allowRender=async()=>{
    if(!env.PDF_RATE_LIMITER) throw new SigningError('簽署用量保護尚未設定',503);
    return (await env.PDF_RATE_LIMITER.limit({key:'signing:documents'})).success;
  };
  if(request.method==='POST' && ['/api/signing/guest','/api/signing/guest/preview'].includes(path)) {
    if(env.SIGNING_SUBMIT_ENABLED!=='true') throw new SigningError('客戶簽署送出尚未開放',503);
    const session=createSigningRenderSession(env);
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
    const session=createSigningRenderSession(env);
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

export async function handleSigningOwner(request,env,auth,decodeImages=decodeImagesUsingBrowser) {
  const allowed=String(env.SIGNING_ALLOWED_EMAILS||'').split(',').map(email=>email.trim().toLowerCase()).filter(Boolean);
  if(auth?.type!=='google' || !allowed.includes(String(auth.user?.email||'').toLowerCase())) throw new SigningError('此帳號尚未開通客戶簽署',403);
  const path=new URL(request.url).pathname;
  if(path==='/api/signing' && request.method==='POST') {
    const {snapshot,lifetimeDays}=validateSigningCreate(await readSigningJson(request));
    if(!env.PDF_RATE_LIMITER) throw new SigningError('簽署用量保護尚未設定',503);
    const limit=await env.PDF_RATE_LIMITER.limit({key:auth.user.id});
    if(!limit.success) throw new SigningError('操作過於頻繁，請稍後重試',429);
    const fixedSnapshot=await decodeImages(env,snapshot);
    const share=await createSigningRequest(env.DB,env.STAMP_BUCKET,auth.workspaceId,fixedSnapshot,lifetimeDays);
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
  if(request.method==='GET') return reply(await loadSigningSnapshotForOwner(env.DB,env.STAMP_BUCKET,auth.workspaceId,id));
  if(request.method==='DELETE') {
    if(!await revokeSigningRequest(env.DB,auth.workspaceId,id)) throw new SigningError('找不到可撤銷的待簽版本',404);
    return reply({ok:true});
  }
  throw new SigningError('不支援此操作',405);
}
