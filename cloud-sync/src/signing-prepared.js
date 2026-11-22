import {SigningError,signingSha256} from './signing-store.js';

export function signingPdfBytes(rendered) {
  const bytes=rendered instanceof Uint8Array?rendered:new Uint8Array(rendered);
  if(bytes.byteLength<8 || bytes.byteLength>12*1024*1024 || new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-') throw new SigningError('待簽 PDF 格式不正確',503);
  return bytes;
}

export async function readPreparedPdf(bucket,key,expectedHash) {
  const object=await bucket.get(key);
  if(!object)return null;
  if(object.size>12*1024*1024)throw new SigningError('待簽 PDF 超過大小上限',503);
  const bytes=signingPdfBytes(await object.arrayBuffer()),sha256=await signingSha256(bytes);
  if(sha256!==(expectedHash||object.customMetadata?.sha256))throw new SigningError('待簽 PDF 完整性檢查失敗',503);
  return {bytes,sha256};
}

export async function storePreparedPdf(bucket,key,rendered) {
  const bytes=signingPdfBytes(rendered),sha256=await signingSha256(bytes);
  await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/pdf',cacheControl:'private, no-store'},customMetadata:{sha256}});
  const stored=await readPreparedPdf(bucket,key);
  if(!stored)throw new SigningError('固定 PDF 尚未保存，請重試',503);
  return stored;
}

export async function clientPreviewKey(id,submission) {
  const {consent,...fields}=submission;
  return `quote-signing/v1/${id}/client-preview-${await signingSha256(JSON.stringify(fields))}.pdf`;
}

async function preparedPrefix(workspaceId,id) {
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new SigningError('固定版本識別碼不正確');
  return `quote-signing/prepared/v1/${await signingSha256(workspaceId)}/${id}`;
}

export async function prepareOwnerSigning(bucket,workspaceId,snapshot,session,now=Date.now()) {
  const fixed=await session.prepareSnapshot(snapshot);
  const id=crypto.randomUUID(),prefix=await preparedPrefix(workspaceId,id);
  const pdf=await storePreparedPdf(bucket,prefix+'.pdf',await session.renderPdf({snapshot:fixed,submission:null}));
  const record={snapshot:fixed,snapshotSha256:await signingSha256(JSON.stringify(fixed)),pdfSha256:pdf.sha256,expiresAt:now+3600000};
  const text=JSON.stringify(record);
  if(new TextEncoder().encode(text).byteLength>20*1024*1024)throw new SigningError('固定版本超過大小上限',413);
  const stored=await bucket.put(prefix+'.json',text,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'},customMetadata:{sha256:await signingSha256(text)}});
  if(!stored)throw new SigningError('固定版本尚未保存，請重試',503);
  return {preparedId:id,expiresAt:record.expiresAt,snapshotSha256:record.snapshotSha256};
}

export async function loadOwnerPrepared(bucket,workspaceId,id,now=Date.now()) {
  const prefix=await preparedPrefix(workspaceId,id),object=await bucket.get(prefix+'.json');
  if(!object)throw new SigningError('找不到本帳號的固定版本，請重新準備',404);
  if(object.size>20*1024*1024)throw new SigningError('固定版本超過大小上限',503);
  const text=await object.text();
  if(await signingSha256(text)!==object.customMetadata?.sha256)throw new SigningError('固定版本完整性檢查失敗',503);
  const record=JSON.parse(text);
  if(!Number.isSafeInteger(record.expiresAt)||record.expiresAt<=now)throw new SigningError('固定預覽已超過一小時，請重新準備並確認',409);
  if(await signingSha256(JSON.stringify(record.snapshot))!==record.snapshotSha256)throw new SigningError('固定報價完整性檢查失敗',503);
  const pdf=await readPreparedPdf(bucket,prefix+'.pdf',record.pdfSha256);
  if(!pdf)throw new SigningError('固定 PDF 無法讀取，請重新準備',503);
  return {...record,pdf};
}
