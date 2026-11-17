import {SigningError,SIGNING_SQL,signingTokenHash,signingSha256,loadSigningSnapshotForOwner} from './signing-store.js';
import {validateSigningSubmission} from './signing-validation.js';

const MAX_PDF_BYTES=12*1024*1024;
const receipt=row=>({id:row.id,status:row.status,submittedAt:row.submitted_at,signedAt:row.signed_at,pdfSha256:row.signed_pdf_sha256});
const unavailable=()=>new SigningError('找不到或連結已失效',404);

async function readSubmission(bucket,row) {
  const object=await bucket.get(row.submission_key);
  if(!object || object.size>8*1024*1024) throw new SigningError('簽署內容無法讀取',503);
  const text=await object.text();
  if(await signingSha256(text)!==row.submission_sha256) throw new SigningError('簽署內容完整性檢查失敗',503);
  return JSON.parse(text);
}

// The trusted caller provides the real image verifier, renderer and usage limiter.
export async function submitSigningRequest(db,bucket,token,body,services) {
  if(typeof services?.validateImage!=='function' || typeof services?.renderPdf!=='function' || typeof services?.allowRender!=='function') throw new SigningError('簽署送出服務尚未啟用',503);
  const clock=services.clock||Date.now;
  const {submission,idempotencyKey}=validateSigningSubmission(body);
  const tokenHash=await signingTokenHash(token),text=JSON.stringify(submission);
  const hash=await signingSha256(text),idempotencyHash=await signingSha256(idempotencyKey);
  let row=await db.prepare(SIGNING_SQL.lookup).bind(tokenHash).first();
  if(!row || row.revoked_at!==null || (row.status==='pending' && row.expires_at<=clock())) throw unavailable();
  if(row.snapshot_sha256!==submission.snapshotSha256) throw new SigningError('報價版本不符，請重新開啟專用連結',409);
  let permitted=false;
  if(row.status==='pending') {
    if(!await services.allowRender(row.id)) throw new SigningError('操作過於頻繁，請稍後重試',429);
    permitted=true;
    const fixed=await loadSigningSnapshotForOwner(db,bucket,row.workspace_id,row.id);
    await services.validateImage(submission.signatureImage,{snapshot:fixed.snapshot,submission});
    const key=`quote-signing/v1/${row.id}/submissions/${crypto.randomUUID()}.json`;
    const object=await bucket.put(key,text,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'},customMetadata:{sha256:hash}});
    if(!object) throw new SigningError('簽署內容尚未保存，請重試',503);
    const claimed=await db.prepare(SIGNING_SQL.claim).bind(tokenHash,clock(),key,hash,idempotencyHash).first();
    row=claimed||await db.prepare(SIGNING_SQL.lookup).bind(tokenHash).first();
  }
  if(!row || row.revoked_at!==null || row.status==='pending') throw unavailable();
  if(row.idempotency_hash!==idempotencyHash || row.submission_sha256!==hash) throw new SigningError('這份報價已接受另一筆簽署，無法覆寫',409);
  if(row.status==='signed') return receipt(row);
  if(row.render_lease_until!==null && row.render_lease_until>clock()) return {...receipt(row),retryAfter:5};
  if(!permitted && !await services.allowRender(row.id)) return {...receipt(row),retryAfter:60};
  const leaseId=crypto.randomUUID();
  const leased=await db.prepare(SIGNING_SQL.lease).bind(row.id,clock(),leaseId).first();
  if(!leased) {
    const latest=await db.prepare(SIGNING_SQL.lookup).bind(tokenHash).first();
    if(!latest || latest.revoked_at!==null) throw unavailable();
    return {...receipt(latest),retryAfter:latest.status==='signed'?undefined:5};
  }
  try {
    const accepted=await readSubmission(bucket,leased);
    const fixed=await loadSigningSnapshotForOwner(db,bucket,leased.workspace_id,leased.id);
    const rendered=await services.renderPdf({snapshot:fixed.snapshot,submission:accepted,submittedAt:leased.submitted_at});
    const bytes=rendered instanceof Uint8Array?rendered:new Uint8Array(rendered);
    if(bytes.byteLength<8 || bytes.byteLength>MAX_PDF_BYTES || new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-') throw new Error('INVALID_SIGNED_PDF');
    const pdfHash=await signingSha256(bytes),key=`quote-signing/v1/${row.id}/signed/${leaseId}.pdf`;
    const stored=await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/pdf',cacheControl:'private, no-store'},customMetadata:{sha256:pdfHash}});
    if(!stored) throw new Error('SIGNED_PDF_NOT_STORED');
    const completed=await db.prepare(SIGNING_SQL.finish).bind(row.id,hash,key,pdfHash,clock(),leaseId).first();
    if(completed) return receipt(completed);
    const latest=await db.prepare(SIGNING_SQL.lookup).bind(tokenHash).first();
    if(!latest || latest.revoked_at!==null) throw unavailable();
    return {...receipt(latest),retryAfter:latest.status==='signed'?undefined:5};
  } catch(error) {
    await db.prepare(SIGNING_SQL.release).bind(row.id,leaseId).run().catch(()=>{});
    if(error instanceof SigningError && error.status===404) throw error;
    throw new SigningError('簽署內容已保存，PDF 暫時無法確認完成；請使用相同內容重試',503);
  }
}

async function readSignedPdf(bucket,row) {
  if(row.status!=='signed') throw new SigningError('已簽 PDF 尚未完成',409);
  const object=await bucket.get(row.signed_pdf_key);
  if(!object || object.size>MAX_PDF_BYTES) throw new SigningError('已簽 PDF 無法讀取',503);
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(await signingSha256(bytes)!==row.signed_pdf_sha256) throw new SigningError('已簽 PDF 完整性檢查失敗',503);
  return {bytes,sha256:row.signed_pdf_sha256,id:row.id};
}

export async function loadSignedPdfForGuest(db,bucket,token,now=Date.now()) {
  const row=await db.prepare(SIGNING_SQL.guest).bind(await signingTokenHash(token),now).first();
  if(!row) throw unavailable();
  return readSignedPdf(bucket,row);
}

export async function loadSignedPdfForOwner(db,bucket,workspaceId,id) {
  const row=await db.prepare(SIGNING_SQL.owner).bind(workspaceId,id).first();
  if(!row) throw unavailable();
  return readSignedPdf(bucket,row);
}
