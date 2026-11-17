import {Buffer} from 'node:buffer';
import {SigningError} from './signing-store.js';

export const MAX_SIGNING_BODY_BYTES = 20 * 1024 * 1024;
const invalid = field => { throw new SigningError(`${field}格式不正確`); };
function object(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid(field);
}
function text(value, max, field) { if (typeof value !== 'string' || value.length > max) invalid(field); }
function number(value, min, max, field) {
  if (value === '' || (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))) invalid(field);
  if (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) invalid(field);
}
function rows(value, max, field, validate) {
  if (!Array.isArray(value) || value.length > max) invalid(field);
  value.forEach(validate);
}
function strings(value, fields, max, label) {
  object(value, fields, label);
  for (const field of fields) text(value[field], max, label);
}

export async function readSigningJson(request) {
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()!=='application/json') throw new SigningError('請使用 JSON 格式',415);
  const declared=request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared)>MAX_SIGNING_BODY_BYTES)) throw new SigningError('簽署資料超過大小上限',413);
  const reader=request.body?.getReader();
  if (!reader) invalid('簽署資料');
  const chunks=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done) break;
      size+=value.byteLength;
      if(size>MAX_SIGNING_BODY_BYTES) {await reader.cancel().catch(()=>{});throw new SigningError('簽署資料超過大小上限',413);}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));} catch {invalid('JSON');}
}

// Signing clients rasterize uploads and the built-in SVG logo to PNG before sending.
function png(value, field) {
  text(value,6*1024*1024,field);
  if(!value) return;
  const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match) invalid(field);
  const bytes=Buffer.from(match[1],'base64');
  if(bytes.length>4*1024*1024 || bytes.length<33 || bytes.toString('base64')!==match[1]
    || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a' || bytes.readUInt32BE(8)!==13 || bytes.toString('ascii',12,16)!=='IHDR') invalid(field);
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width || !height || width>4096 || height>4096 || width*height>4000000) invalid(field);
}

function stamp(value) {
  const fields=['enabled','assetId','assetVersionId','assetName','sourceDataUrl','mimeType','originalWidthPx','originalHeightPx','widthMm','heightMm','xMm','yMm','rotationDeg','opacity','layer','allowOverflow','lockAspectRatio','cropEnabled','crop','blendMode','anchor','schemaVersion'];
  object(value,fields,'印章');
  for(const key of ['enabled','allowOverflow','lockAspectRatio','cropEnabled']) if(typeof value[key]!=='boolean') invalid('印章');
  for(const key of ['assetId','assetVersionId','assetName','mimeType','anchor']) text(value[key],200,'印章');
  png(value.sourceDataUrl,'印章圖片');
  if(value.enabled && (value.assetId || value.assetVersionId) && !value.sourceDataUrl) invalid('印章缺少固定圖片');
  for(const key of ['originalWidthPx','originalHeightPx']) number(value[key],0,4096,'印章');
  for(const key of ['widthMm','heightMm']) number(value[key],1,120,'印章');
  for(const key of ['xMm','yMm']) number(value[key],-120,120,'印章');
  number(value.rotationDeg,-180,180,'印章');number(value.opacity,0,100,'印章');
  if(!['top','bottom'].includes(value.layer) || !['normal','multiply'].includes(value.blendMode) || value.schemaVersion!==1) invalid('印章');
  if(value.crop!==null) {
    object(value.crop,['x','y','width','height'],'裁切');
    for(const key of ['x','y','width','height']) number(value.crop[key],0,1,'裁切');
    if(Number(value.crop.width)<=0 || Number(value.crop.height)<=0 || Number(value.crop.x)+Number(value.crop.width)>1 || Number(value.crop.y)+Number(value.crop.height)>1) invalid('裁切');
  } else if(value.cropEnabled) invalid('裁切');
}

export function validateSigningCreate(body) {
  object(body,['confirmed','snapshot','lifetimeDays'],'待簽版本');
  if(body.confirmed!==true) throw new SigningError('請先確認報價內容，再建立待簽版本');
  const days=body.lifetimeDays??14;
  if(!Number.isInteger(days) || days<1 || days>30) invalid('連結期限');
  const snapshot=body.snapshot;
  object(snapshot,['quotation','printScale','rendererVersion','printDocument'],'快照');
  if(snapshot.rendererVersion!==1) invalid('版型版本');
  if(!Number.isInteger(snapshot.printScale) || snapshot.printScale<70 || snapshot.printScale>100) invalid('列印比例');
  const q=snapshot.quotation;
  object(q,['schemaVersion','quotationType','header','project','categories','items','notes','payment','bank','signature','logo','taxMode','printSettings'],'報價');
  if(q.schemaVersion!==4 || !['quick','detailed'].includes(q.quotationType) || !['excluded','inclusive_flat','included'].includes(q.taxMode)) invalid('報價版本');
  strings(q.header,['title','quotationId','quotationDate','validityLabel','validity'],2000,'報價表頭');
  if(!q.header.quotationId.trim()) invalid('報價單號');
  rows(q.project,30,'專案概況',row=>strings(row,['label','value'],2000,'專案概況'));
  const ids=new Set();
  rows(q.categories,30,'服務分類',row=>{
    object(row,['id','name','summaryQty','summaryUnit'],'服務分類');
    text(row.id,160,'分類代號');text(row.name,200,'分類名稱');text(row.summaryUnit,40,'單位');
    if(!/^[A-Za-z0-9_-]+$/.test(row.id) || ['__proto__','constructor','prototype'].includes(row.id) || ids.has(row.id)) invalid('分類代號');
    ids.add(row.id);
    if(row.summaryQty!=='') number(row.summaryQty,0,1000000,'數量');
  });
  object(q.items,[...ids],'服務細項');
  for(const list of Object.values(q.items)) rows(list,200,'服務細項',row=>{
    object(row,['id','desc','qty','unit','price'],'服務細項');
    if(row.id!==undefined) text(row.id,160,'項目代號');
    text(row.desc,2000,'服務說明');text(row.unit,40,'單位');
    number(row.qty,0,1000000,'數量');number(row.price,-1000000000,1000000000,'單價');
  });
  rows(q.notes,100,'條款',row=>{object(row,['id','text'],'條款');text(row.id,160,'條款代號');text(row.text,20000,'條款');});
  object(q.payment,['terms'],'付款');
  rows(q.payment.terms,20,'付款期別',row=>strings(row,['phase','percent','condition','notes'],2000,'付款期別'));
  strings(q.bank,['accountName','bankName','accountNumber'],200,'收款資訊');
  object(q.printSettings,['scaledMode','showDetails','showSigDate'],'列印設定');
  for(const key of ['scaledMode','showDetails','showSigDate']) if(typeof q.printSettings[key]!=='boolean') invalid('列印設定');
  const signatureText=['clientCompany','clientContact','clientTaxId','clientPhone','vendorCompany','vendorContact','vendorTaxId','vendorPhone','signatureDate'];
  object(q.signature,[...signatureText,'clientSigImg','vendorSigImg','clientStamp','vendorStamp'],'簽署');
  for(const key of signatureText) text(q.signature[key],200,'簽署資料');
  for(const key of ['clientSigImg','vendorSigImg']) png(q.signature[key],'簽名圖片');
  stamp(q.signature.clientStamp);stamp(q.signature.vendorStamp);png(q.logo,'Logo');
  const document=snapshot.printDocument;
  object(document,['html','css','viewportWidth'],'固定列印版型');
  text(document.html,12*1024*1024,'列印內容');text(document.css,2*1024*1024,'列印樣式');
  if(!Number.isInteger(document.viewportWidth) || document.viewportWidth<320 || document.viewportWidth>2560
    || !document.html.includes('print-pagination-root') || !document.html.includes('data-signing-client-signature')
    || /<(?:script|iframe|object|embed|base|meta|link|form|svg)\b|\son[a-z]+\s*=|\bsrcset\s*=/i.test(document.html)
    || /<\/style/i.test(document.css)) invalid('固定列印版型');
  for(const img of document.html.match(/<img\b[^>]*>/gi)||[]) {
    const source=/\bsrc\s*=\s*["'](data:image\/png;base64,[A-Za-z0-9+/=]+)["']/i.exec(img);
    if(!source) invalid('列印圖片');png(source[1],'列印圖片');
  }
  return {snapshot,lifetimeDays:days};
}

export function validateSigningSubmission(body) {
  object(body,['idempotencyKey','snapshotSha256','clientCompany','clientContact','clientTaxId','clientPhone','signatureImage','signatureKind','consent'],'客戶簽署');
  if(typeof body.idempotencyKey!=='string' || !/^[A-Za-z0-9_-]{20,80}$/.test(body.idempotencyKey)) invalid('送出識別碼');
  if(typeof body.snapshotSha256!=='string' || !/^[a-f0-9]{64}$/.test(body.snapshotSha256)) invalid('報價版本');
  if(body.consent!==true) throw new SigningError('請先預覽並確認同意簽署');
  for(const key of ['clientCompany','clientContact','clientTaxId','clientPhone']) text(body[key],200,'甲方資料');
  if(!body.clientCompany.trim() && !body.clientContact.trim()) invalid('甲方姓名或公司');
  if(!['handwritten','stamp'].includes(body.signatureKind)) invalid('簽署方式');
  png(body.signatureImage,'甲方簽名或印章');
  if(!body.signatureImage) invalid('甲方簽名或印章');
  return {idempotencyKey:body.idempotencyKey,submission:{version:1,snapshotSha256:body.snapshotSha256,
    clientCompany:body.clientCompany,clientContact:body.clientContact,clientTaxId:body.clientTaxId,clientPhone:body.clientPhone,
    signatureImage:body.signatureImage,signatureKind:body.signatureKind,consent:true}};
}

export async function rasterizeSigningImages(page, snapshot) {
  const q=snapshot.quotation;
  const targets=[[q,'logo'],[q.signature,'clientSigImg'],[q.signature,'vendorSigImg'],[q.signature.clientStamp,'sourceDataUrl'],[q.signature.vendorStamp,'sourceDataUrl']].filter(([object,key])=>object[key]);
  if(!targets.length) return snapshot;
  await page.setRequestInterception(true);
  page.on('request',request=>void request.abort());
  await page.setContent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">');
  const images=await page.evaluate(async sources=>{
    const result=[];
    for(const source of sources) {
      const img=new Image();img.src=source;
      await Promise.race([img.decode(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('IMAGE_TIMEOUT')),5000))]);
      const width=img.naturalWidth,height=img.naturalHeight;
      if(!width || !height || width>4096 || height>4096 || width*height>4000000) throw new Error('IMAGE_DIMENSIONS');
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      canvas.getContext('2d').drawImage(img,0,0);
      result.push(canvas.toDataURL('image/png'));
    }
    return result;
  },targets.map(([object,key])=>object[key]));
  images.forEach((image,i)=>{const [object,key]=targets[i];object[key]=image;});
  return snapshot;
}
