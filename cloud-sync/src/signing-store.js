const DAY_MS = 86400000;
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;

export class SigningError extends Error {
  constructor(message, status = 400, retryAfter) { super(message); this.status = status; if(Number.isInteger(retryAfter) && retryAfter>0)this.retryAfter=retryAfter; }
}

export const SIGNING_SQL = Object.freeze({
  create: `INSERT INTO quote_signing_requests
    (id,workspace_id,token_hash,snapshot_key,snapshot_sha256,created_at,expires_at,quotation_id)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
  list: `SELECT id,quotation_id AS quotationId,status,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt,signed_at AS signedAt
    FROM quote_signing_requests WHERE workspace_id=?1 ORDER BY created_at DESC,id DESC LIMIT 26 OFFSET ?2`,
  guest: `SELECT * FROM quote_signing_requests
    WHERE token_hash=?1 AND revoked_at IS NULL AND expires_at>?2 LIMIT 1`,
  lookup: `SELECT * FROM quote_signing_requests WHERE token_hash=?1 LIMIT 1`,
  owner: `SELECT * FROM quote_signing_requests WHERE workspace_id=?1 AND id=?2 LIMIT 1`,
  revoke: `UPDATE quote_signing_requests SET revoked_at=?3
    WHERE workspace_id=?1 AND id=?2 AND revoked_at IS NULL`,
  claim: `UPDATE quote_signing_requests
    SET status='submitting',submission_key=?3,submission_sha256=?4,idempotency_hash=?5,submitted_at=?2
    WHERE token_hash=?1 AND status='pending' AND revoked_at IS NULL AND expires_at>?2 RETURNING *`,
  finish: `UPDATE quote_signing_requests
    SET status='signed',signed_pdf_key=?3,signed_pdf_sha256=?4,signed_at=?5,render_lease_id=NULL,render_lease_until=NULL
    WHERE id=?1 AND status='submitting' AND submission_sha256=?2 AND revoked_at IS NULL
      AND render_lease_id=?6 AND render_lease_until>?5 RETURNING *`,
  lease: `UPDATE quote_signing_requests SET render_lease_id=?3,render_lease_until=?2+120000
    WHERE id=?1 AND status='submitting' AND revoked_at IS NULL
      AND (render_lease_until IS NULL OR render_lease_until<=?2) RETURNING *`,
  release: `UPDATE quote_signing_requests SET render_lease_id=NULL,render_lease_until=NULL
    WHERE id=?1 AND status='submitting' AND render_lease_id=?2`
});

export async function signingSha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', typeof value==='string'?new TextEncoder().encode(value):value);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validWorkspace(workspaceId) {
  if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 200) {
    throw new SigningError('工作區識別碼不正確');
  }
}

export async function signingTokenHash(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new SigningError('找不到或連結已失效', 404);
  }
  return signingSha256(token);
}

export async function signingShareToken(secret,id) {
  if(typeof secret!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(secret))throw new SigningError('簽署連結金鑰尚未設定',503);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('qt-signing-link:v1:'+id)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}

export async function listSigningRequests(db,workspaceId,offset=0) {
  validWorkspace(workspaceId);
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new SigningError('簽署清單頁碼不正確');
  const {results}=await db.prepare(SIGNING_SQL.list).bind(workspaceId,offset).all();
  return {items:results.slice(0,25),nextOffset:results.length>25?offset+25:null};
}

// The caller must supply the confirmed, self-contained quote, not its project-library record.
export async function createSigningRequest(db, bucket, workspaceId, snapshot, lifetimeDays = 14, now = Date.now(), linkSecret,previewPdf) {
  validWorkspace(workspaceId);
  if (!Number.isInteger(lifetimeDays) || lifetimeDays < 1 || lifetimeDays > 30 || !Number.isSafeInteger(now)) {
    throw new SigningError('連結期限須為 1–30 天');
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new SigningError('待簽快照不正確');
  let contents;
  try { contents = JSON.stringify(snapshot); } catch { throw new SigningError('待簽快照無法序列化'); }
  if (!contents || new TextEncoder().encode(contents).byteLength > MAX_SNAPSHOT_BYTES) throw new SigningError('待簽快照超過大小上限', 413);
  const id = crypto.randomUUID();
  const token = linkSecret ? await signingShareToken(linkSecret,id) : btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const hash = await signingSha256(contents);
  const key = `quote-signing/v1/${id}/snapshot.json`;
  const expiresAt = now + lifetimeDays * DAY_MS;
  const object = await bucket.put(key, contents, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' },
    customMetadata: { sha256: hash }
  });
  if (!object) throw new SigningError('無法建立固定待簽版本', 409);
  if(previewPdf) {
    const stored=await bucket.put(`quote-signing/v1/${id}/preview-${hash}.pdf`,previewPdf.bytes,{
      onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/pdf',cacheControl:'private, no-store'},customMetadata:{sha256:previewPdf.sha256}
    });
    if(!stored)throw new SigningError('固定 PDF 尚未保存，尚未建立連結',503);
  }
  // Keep the private object if D1 reports an error: the commit outcome may be uncertain.
  await db.prepare(SIGNING_SQL.create).bind(id, workspaceId, await signingTokenHash(token), key, hash, now, expiresAt,String(snapshot.quotation?.header?.quotationId||'').slice(0,2000)).run();
  return { id, token, snapshotSha256: hash, expiresAt };
}

export async function loadSigningSnapshot(db, bucket, token, now = Date.now()) {
  const row = await db.prepare(SIGNING_SQL.guest).bind(await signingTokenHash(token), now).first();
  if (!row) throw new SigningError('找不到或連結已失效', 404);
  return { id: row.id, status: row.status, expiresAt: row.expires_at, snapshotSha256:row.snapshot_sha256, snapshot: await readSnapshotObject(bucket,row) };
}

async function readSnapshotObject(bucket,row) {
  const object = await bucket.get(row.snapshot_key);
  if (!object || object.size > MAX_SNAPSHOT_BYTES) throw new SigningError('待簽版本無法讀取', 503);
  const text = await object.text();
  if (await signingSha256(text) !== row.snapshot_sha256) throw new SigningError('待簽版本完整性檢查失敗', 503);
  return JSON.parse(text);
}

export async function loadSigningSnapshotForOwner(db,bucket,workspaceId,id,linkSecret) {
  validWorkspace(workspaceId);
  const row=await db.prepare(SIGNING_SQL.owner).bind(workspaceId,id).first();
  if(!row) throw new SigningError('找不到待簽版本',404);
  let url=null;
  if(linkSecret){const token=await signingShareToken(linkSecret,id);if(await signingTokenHash(token)===row.token_hash)url='https://quote.kinostudio.tw/s/'+token;}
  return {id:row.id,status:row.status,createdAt:row.created_at,expiresAt:row.expires_at,revokedAt:row.revoked_at,signedAt:row.signed_at,url,snapshotSha256:row.snapshot_sha256,snapshot:await readSnapshotObject(bucket,row)};
}

export async function revokeSigningRequest(db, workspaceId, id, now = Date.now()) {
  validWorkspace(workspaceId);
  const result = await db.prepare(SIGNING_SQL.revoke).bind(workspaceId, id, now).run();
  return Boolean(result.meta.changes);
}
