import {SigningError,loadSigningSnapshot,signingSha256} from './signing-store.js';
import {loadSignedPdfForGuest} from './signing-submit.js';

export async function loadSigningPreview(db,bucket,token,services) {
  const fixed=await loadSigningSnapshot(db,bucket,token);
  if(fixed.status==='signed') return {...await loadSignedPdfForGuest(db,bucket,token),quotationId:fixed.snapshot.quotation.header.quotationId};
  if(fixed.status!=='pending') throw new SigningError('簽署處理中，請等待已簽PDF完成',409);
  const key=`quote-signing/v1/${fixed.id}/preview-${fixed.snapshotSha256}.pdf`;
  const read=async object=>{
    if(!object || object.size>12*1024*1024) throw new SigningError('待簽PDF無法讀取',503);
    const bytes=new Uint8Array(await object.arrayBuffer()),hash=await signingSha256(bytes);
    if(hash!==object.customMetadata?.sha256) throw new SigningError('待簽PDF完整性檢查失敗',503);
    return {bytes,sha256:hash,id:fixed.id,quotationId:fixed.snapshot.quotation.header.quotationId};
  };
  const cached=await bucket.get(key);if(cached) return read(cached);
  if(!await services.allowRender(fixed.id)) throw new SigningError('預覽過於頻繁，請稍後重試',429);
  const rendered=await services.renderPdf({snapshot:fixed.snapshot,submission:null});
  const bytes=rendered instanceof Uint8Array?rendered:new Uint8Array(rendered);
  if(bytes.byteLength<8 || bytes.byteLength>12*1024*1024 || new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-') throw new SigningError('待簽PDF無法產生',503);
  const hash=await signingSha256(bytes);
  const current=await loadSigningSnapshot(db,bucket,token);
  if(current.status!=='pending') throw new SigningError('簽署狀態已變更，請重新載入',409);
  await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/pdf',cacheControl:'private, no-store'},customMetadata:{sha256:hash}});
  return read(await bucket.get(key));
}
