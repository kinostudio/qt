const REDIRECT = 'https://qt.kinostudio.tw/onedrive-link.html';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const SCOPE = 'offline_access https://graph.microsoft.com/Files.ReadWrite';
const LIMIT = 2 * 1024 * 1024;
const encoder = new TextEncoder();

export class OneDriveBindingError extends Error {
  constructor(message, status = 400, code = '') {
    super(message);
    this.name = 'OneDriveBindingError';
    this.status = status;
    this.code = code;
  }
}
const fail = (message, status = 400, code = '') => { throw new OneDriveBindingError(message, status, code); };
const reauth = () => fail('OneDrive 授權已失效，請重新連接 Microsoft 帳號', 409, 'ONEDRIVE_REAUTH_REQUIRED');
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0));
const digest = async value => encode(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9!_-]{1,256}$/.test(value);
const response = body => Response.json(body, {headers: {'cache-control': 'no-store'}});
const sql = (env, query, ...args) => env.DB.prepare(query).bind(...args);
const binding = (env, workspace) => sql(env, 'SELECT * FROM onedrive_bindings WHERE workspace_id=?1', workspace).first();

export function isOneDriveBindingEnabled(env) {
  try {
    return env.ONEDRIVE_BINDING_ENABLED === 'true' &&
      typeof env.MICROSOFT_CLIENT_SECRET === 'string' && !!env.MICROSOFT_CLIENT_SECRET.trim() &&
      typeof env.MICROSOFT_CLIENT_ID === 'string' && !!env.MICROSOFT_CLIENT_ID.trim() &&
      env.ONEDRIVE_REDIRECT_URI === REDIRECT && /^[A-Za-z0-9_-]{43}$/.test(env.ONEDRIVE_TOKEN_KEY || '') &&
      decode(env.ONEDRIVE_TOKEN_KEY).length === 32 && encode(decode(env.ONEDRIVE_TOKEN_KEY)) === env.ONEDRIVE_TOKEN_KEY;
  } catch { return false; }
}

async function crypt(env, workspace, value, encrypt) {
  try {
    const key = await crypto.subtle.importKey('raw', decode(env.ONEDRIVE_TOKEN_KEY), 'AES-GCM', false, [encrypt ? 'encrypt' : 'decrypt']);
    if (encrypt) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: encoder.encode(workspace)}, key, encoder.encode(value));
      return `${encode(iv)}.${encode(ciphertext)}`;
    }
    const [iv, ciphertext, extra] = value.split('.');
    if (extra || !iv || !ciphertext || decode(iv).length !== 12) throw new Error();
    return new TextDecoder('utf-8', {fatal: true}).decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(workspace)}, key, decode(ciphertext)));
  } catch { fail('無法讀取 OneDrive 授權憑證，請稍後再試或重新連接帳號', 503); }
}

async function readJson(source, external = false) {
  const status = external ? 502 : 413;
  if (Number(source.headers.get('content-length')) > LIMIT) {
    if (source.body) await source.body.cancel();
    fail(external ? 'OneDrive 回應資料過大' : '傳送的資料過大', status);
  }
  const reader = source.body?.getReader();
  const chunks = [];
  let length = 0;
  try {
    if (reader) while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > LIMIT) { await reader.cancel(); fail(external ? 'OneDrive 回應資料過大' : '傳送的資料過大', status); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!plain(value)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof OneDriveBindingError) throw error;
    fail(external ? 'OneDrive 回應格式不正確，請稍後再試' : '傳送的 JSON 資料格式不正確', external ? 502 : 400);
  } finally { reader?.releaseLock(); }
}

async function external(fetchFn, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const result = await fetchFn(url, {...options, redirect: 'error', signal: controller.signal});
    const data = await readJson(result, true);
    return {status: result.status, ok: result.ok, data};
  } catch (error) {
    if (error instanceof OneDriveBindingError) throw error;
    fail('無法連線至 OneDrive 或連線逾時，請稍後再試', 502);
  } finally { clearTimeout(timer); }
}

async function tokens(env, fetchFn, grant) {
  return external(fetchFn, TOKEN, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET,
    redirect_uri: REDIRECT, scope: SCOPE, ...grant,
  }).toString()});
}
const validToken = value => typeof value === 'string' && value.length > 0 && value.length <= 32768 && !/[\r\n]/.test(value);
function status(row) {
  if (!row) return {bound: false};
  return {bound: true, revision: row.revision,
    account: {homeAccountId: row.drive_id, name: row.account_name, username: row.account_username},
    folder: row.folder_json ? JSON.parse(row.folder_json) : null, needsReconnect: !!row.needs_reconnect};
}

async function start(env, workspace, body) {
  if (typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) fail('授權驗證資料格式不正確，請重新開始連接');
  const state = random();
  const row = await binding(env, workspace);
  await sql(env, `INSERT INTO onedrive_binding_attempts(workspace_id,state_hash,challenge,base_revision,expires_at,consumed)
    VALUES(?1,?2,?3,?4,?5,0) ON CONFLICT(workspace_id) DO UPDATE SET
    state_hash=excluded.state_hash,challenge=excluded.challenge,base_revision=excluded.base_revision,expires_at=excluded.expires_at,consumed=0`,
  workspace, await digest(state), body.challenge, row?.revision || null, Date.now() + 600000).run();
  const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  url.search = new URLSearchParams({client_id: env.MICROSOFT_CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT,
    response_mode: 'query', scope: SCOPE, state, code_challenge: body.challenge, code_challenge_method: 'S256'}).toString();
  return response({state, authorizationUrl: url.href});
}

async function complete(env, workspace, body, fetchFn) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(body.state || '') || typeof body.verifier !== 'string' ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(body.verifier) || !validToken(body.code)) fail('授權回傳資料不正確，請重新開始連接');
  const stateHash = await digest(body.state);
  // Consume atomically before any provider request; failed exchange requires a new start.
  const attempt = await sql(env, `UPDATE onedrive_binding_attempts SET consumed=1
    WHERE workspace_id=?1 AND state_hash=?2 AND challenge=?3 AND expires_at>?4 AND consumed=0 RETURNING *`,
  workspace, stateHash, await digest(body.verifier), Date.now()).first();
  if (!attempt) fail('授權請求無效或已過期，請重新開始連接', 400);
  const token = await tokens(env, fetchFn, {grant_type: 'authorization_code', code: body.code, code_verifier: body.verifier});
  if (!token.ok || !validToken(token.data.access_token) || !validToken(token.data.refresh_token)) fail('OneDrive 授權失敗，請重新連接 Microsoft 帳號', 409);
  const drive = await external(fetchFn, `${GRAPH}/me/drive?$select=id,owner`, {headers: {authorization: `Bearer ${token.data.access_token}`}});
  if (!drive.ok || !opaque(drive.data.id)) fail('無法讀取 OneDrive 帳號資料，請稍後再試', 502);
  const owner = drive.data.owner?.user;
  const encrypted = await crypt(env, workspace, token.data.refresh_token, true);
  const revision = crypto.randomUUID();
  // The retained attempt fences exchanges that overlap unlink or a newer start/rebind.
  const saved = await sql(env, `INSERT INTO onedrive_bindings(workspace_id,revision,drive_id,account_name,account_username,refresh_encrypted)
    SELECT ?1,?2,?3,?4,?5,?6 FROM onedrive_binding_attempts
    WHERE workspace_id=?1 AND state_hash=?7 AND consumed=1 AND expires_at>?8
      AND base_revision IS (SELECT revision FROM onedrive_bindings WHERE workspace_id=?1)
    ON CONFLICT(workspace_id) DO UPDATE SET revision=excluded.revision,drive_id=excluded.drive_id,
      account_name=excluded.account_name,account_username=excluded.account_username,refresh_encrypted=excluded.refresh_encrypted,
      folder_json=NULL,needs_reconnect=0,lease_id=NULL,lease_until=0
    WHERE onedrive_bindings.lease_until<=?8 RETURNING workspace_id`,
  workspace, revision, drive.data.id, typeof owner?.displayName === 'string' ? owner.displayName.slice(0,200) : '',
  typeof owner?.email === 'string' ? owner.email.slice(0,320) : '', encrypted, stateHash, Date.now()).first();
  if (!saved) fail('OneDrive 綁定已變更或正在處理其他操作，請重新開始連接', 409);
  await sql(env, 'DELETE FROM onedrive_binding_attempts WHERE workspace_id=?1 AND state_hash=?2', workspace, stateHash).run();
  return response(status(await binding(env, workspace)));
}

async function withDrive(env, workspace, expectedRevision, fetchFn, operation) {
  const row = await binding(env, workspace);
  if (!row) fail('尚未綁定 OneDrive，請先連接 Microsoft 帳號', 409);
  if (expectedRevision !== undefined && expectedRevision !== row.revision) fail('OneDrive 設定已變更，請重新載入設定後再試', 409);
  if (row.needs_reconnect) reauth();
  const lease = crypto.randomUUID();
  const acquired = await sql(env, `UPDATE onedrive_bindings SET lease_id=?3,lease_until=?4
    WHERE workspace_id=?1 AND revision=?2 AND lease_until<=?5 RETURNING workspace_id`,
  workspace, row.revision, lease, Date.now() + 30000, Date.now()).first();
  if (!acquired) fail('OneDrive 正在處理其他操作或綁定已變更，請重新載入設定後再試', 409);
  const guard = async () => {
    const held = await sql(env, `UPDATE onedrive_bindings SET lease_until=?4
      WHERE workspace_id=?1 AND revision=?2 AND lease_id=?3 AND lease_until>?5 RETURNING workspace_id`,
    workspace, row.revision, lease, Date.now()+30000, Date.now()).first();
    if (!held) fail('OneDrive 綁定已變更或操作已逾時，請重新載入設定後再試', 409);
  };
  const reconnect = async () => {
    await sql(env, `UPDATE onedrive_bindings SET needs_reconnect=1 WHERE workspace_id=?1 AND revision=?2 AND lease_id=?3 AND lease_until>?4`,
      workspace, row.revision, lease, Date.now()).run();
    reauth();
  };
  try {
    const refresh = await crypt(env, workspace, row.refresh_encrypted, false);
    await guard();
    const token = await tokens(env, fetchFn, {grant_type: 'refresh_token', refresh_token: refresh});
    if (token.data.error === 'invalid_grant' || token.status === 401) return await reconnect();
    if (!token.ok || !validToken(token.data.access_token) ||
        (token.data.refresh_token !== undefined && !validToken(token.data.refresh_token))) fail('無法更新 OneDrive 授權，請稍後再試', 502);
    // Commit refresh rotation before Graph; stale workers cannot overwrite a newer binding.
    const encrypted = await crypt(env, workspace, token.data.refresh_token || refresh, true);
    const rotated = await sql(env, `UPDATE onedrive_bindings SET refresh_encrypted=?4
      WHERE workspace_id=?1 AND revision=?2 AND lease_id=?3 AND lease_until>?5 RETURNING workspace_id`,
    workspace, row.revision, lease, encrypted, Date.now()).first();
    if (!rotated) fail('OneDrive 綁定已變更或操作已逾時，請重新載入設定後再試', 409);
    const graph = async (path, options = {}, allowed = []) => {
      await guard();
      const result = await external(fetchFn, GRAPH + path, {...options, headers: {...options.headers, authorization: `Bearer ${token.data.access_token}`}});
      if (result.status === 401) return reconnect();
      if (!result.ok && !allowed.includes(result.status)) fail('OneDrive 操作失敗，請重新載入設定並確認存取權限後再試', [403,404,409,412].includes(result.status) ? result.status : 502);
      return result;
    };
    const value = await operation({row, graph, guard, lease});
    await guard();
    return value;
  } finally {
    await sql(env, 'UPDATE onedrive_bindings SET lease_id=NULL,lease_until=0 WHERE workspace_id=?1 AND lease_id=?2', workspace, lease).run();
  }
}

const itemPath = (row, id) => `/drives/${encodeURIComponent(row.drive_id)}/${id === 'root' ? 'root' : `items/${encodeURIComponent(id)}`}`;
function ownFolder(item, row) {
  if (!opaque(item?.id) || !plain(item.folder) || item.remoteItem ||
      (item.parentReference?.driveId && item.parentReference.driveId !== row.drive_id)) fail('請選擇目前綁定 OneDrive 中的資料夾，不支援共用捷徑', 400);
  return item;
}
function folderMetadata(item, row) {
  ownFolder(item, row);
  const parent = typeof item.parentReference?.path === 'string' ? item.parentReference.path.split('root:')[1] : '';
  return {id: item.id, name: typeof item.name === 'string' ? item.name : '',
    path: item.root ? '/' : `${parent || ''}/${item.name || ''}`};
}
async function folders(ctx, url) {
  const folderId = url.searchParams.get('folderId') || 'root';
  if (!opaque(folderId)) fail('資料夾識別碼不正確，請重新選擇資料夾');
  const path = itemPath(ctx.row, folderId) + '/children';
  let target = path + '?$select=id,name,folder,parentReference,remoteItem,root&$top=100';
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    if (cursor.length > 8192) fail('資料夾分頁資訊不正確，請重新載入資料夾');
    let parsed;
    try { parsed = new URL(cursor); } catch { fail('資料夾分頁資訊不正確，請重新載入資料夾'); }
    if (parsed.origin !== 'https://graph.microsoft.com' || parsed.username || parsed.password || parsed.hash || parsed.pathname !== '/v1.0'+path ||
        [...parsed.searchParams.keys()].some(key => !['$select','$top','$skiptoken','$skipToken','$orderby'].includes(key))) fail('資料夾分頁資訊不正確，請重新載入資料夾');
    target = path + parsed.search;
  }
  ownFolder((await ctx.graph(itemPath(ctx.row, folderId))).data, ctx.row);
  const data = (await ctx.graph(target)).data;
  if (!Array.isArray(data.value)) fail('OneDrive 回應格式不正確，請稍後再試', 502);
  const items = data.value.filter(item => plain(item.folder) && !item.remoteItem && (!item.parentReference?.driveId || item.parentReference.driveId === ctx.row.drive_id))
    .map(item => ({...folderMetadata(item, ctx.row), folder: {}}));
  let next = null;
  if (data['@odata.nextLink']) {
    let nextUrl;
    try { nextUrl = new URL(data['@odata.nextLink']); } catch { fail('OneDrive 回傳的分頁資訊不正確，請重新載入資料夾', 502); }
    if (nextUrl.origin !== 'https://graph.microsoft.com' || nextUrl.username || nextUrl.password || nextUrl.hash || nextUrl.pathname !== '/v1.0'+path ||
        [...nextUrl.searchParams.keys()].some(key => !['$select','$top','$skiptoken','$skipToken','$orderby'].includes(key)) || nextUrl.href.length > 8192) fail('OneDrive 回傳的分頁資訊不正確，請重新載入資料夾', 502);
    next = nextUrl.href;
  }
  return response({value: items, nextCursor: next});
}

function safeName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) || /[\\/]/.test(value) ||
      /%[0-9a-f]{2}/i.test(value) || value.includes('..')) fail('報價單檔名不正確，請確認單號不含路徑或控制字元');
  const name = value.trim().normalize('NFC').replace(/[:*?"<>|#%]+/g, '-').replace(/[. ]+$/g, '');
  if (!name || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ||
      /^(?:\.lock|desktop\.ini|~\$)/i.test(name) || /_vti_/i.test(name) || /^forms$/i.test(name)) fail('報價單檔名為系統保留名稱，請修改報價單號');
  return name;
}

async function save(ctx, body) {
  if (!plain(body.quotation) || !plain(body.quotation.header) || body.quotation.header.quotationId !== body.quotationId) fail('報價單資料格式不正確或單號不一致，請確認後再儲存');
  const name = safeName(body.quotationId);
  if (!ctx.row.folder_json) fail('請先選擇 OneDrive 儲存資料夾', 409);
  const selected = JSON.parse(ctx.row.folder_json);
  let parent = ownFolder((await ctx.graph(itemPath(ctx.row, selected.id))).data, ctx.row);
  if (selected.autoCreateProjectFolder) {
    const projectName = safeName(name.replace(/\s*[_-]\s*KS\d+\s*$/i, '').trim());
    const lookup = itemPath(ctx.row, parent.id) + ':/' + encodeURIComponent(projectName);
    let found = await ctx.graph(lookup, {}, [404]);
    if (found.status === 404) {
      found = await ctx.graph(itemPath(ctx.row, parent.id) + '/children', {method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({name: projectName, folder: {}, '@microsoft.graph.conflictBehavior': 'fail'})}, [409]);
      if (found.status === 409) found = await ctx.graph(lookup);
    }
    parent = ownFolder(found.data, ctx.row);
  }
  const filename = name + '.json';
  const path = itemPath(ctx.row, parent.id) + ':/' + encodeURIComponent(filename);
  const current = await ctx.graph(path, {}, [404]);
  const headers = {'content-type': 'application/json; charset=utf-8'};
  if (current.status === 404) headers['If-None-Match'] = '*';
  else {
    if (current.data.folder || current.data.remoteItem || current.data.parentReference?.driveId !== ctx.row.drive_id ||
        typeof current.data.eTag !== 'string' || !current.data.eTag || /[\r\n]/.test(current.data.eTag)) fail('無法確認 OneDrive 檔案狀態，為避免覆寫已停止儲存，請重新載入後再試', 409);
    headers['If-Match'] = current.data.eTag;
  }
  // Provider enforcement of conditional PUT/content is not production-verified.
  const written = await ctx.graph(path + ':/content', {method: 'PUT', headers, body: JSON.stringify(body.quotation)});
  if (!opaque(written.data.id)) fail('無法確認 OneDrive 儲存結果，請先檢查目的資料夾', 502);
  return response({id: written.data.id, name: filename});
}

export async function handleOneDriveBinding(request, env, auth, fetchFn = fetch) {
  if (!isOneDriveBindingEnabled(env)) fail('OneDrive 帳號綁定功能尚未啟用', 404);
  if (auth?.type !== 'google' || typeof auth.workspaceId !== 'string' || !auth.workspaceId.startsWith('user:') || auth.workspaceId.length <= 5) fail('請先登入 Google 帳號', 401);
  try {
    const workspace = auth.workspaceId;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (path === '/api/onedrive' && method === 'GET') return response(status(await binding(env, workspace)));
    if (path === '/api/onedrive' && method === 'DELETE') {
      // Both deletions are one transaction; active Graph operations keep their binding and attempts.
      await env.DB.batch([
        sql(env, 'DELETE FROM onedrive_bindings WHERE workspace_id=?1 AND lease_until<=?2', workspace, Date.now()),
        sql(env, `DELETE FROM onedrive_binding_attempts WHERE workspace_id=?1
          AND NOT EXISTS(SELECT 1 FROM onedrive_bindings WHERE workspace_id=?1)`, workspace),
      ]);
      if (await binding(env, workspace)) fail('OneDrive 正在處理其他操作或綁定已變更，請重新載入設定後再試', 409);
      return response({bound: false});
    }
    if (method === 'POST' && path === '/api/onedrive/start') return await start(env, workspace, await readJson(request));
    if (method === 'POST' && path === '/api/onedrive/complete') return await complete(env, workspace, await readJson(request), fetchFn);
    if (method === 'GET' && path === '/api/onedrive/folders') return await withDrive(env, workspace, undefined, fetchFn, ctx => folders(ctx, url));
    if (method === 'POST' && (path === '/api/onedrive/folder' || path === '/api/onedrive/save')) {
      const body = await readJson(request);
      if (typeof body.revision !== 'string' || !body.revision) fail('缺少 OneDrive 設定版本，請重新載入設定後再試', 409);
      if (path.endsWith('/folder') && (!opaque(body.folderId) || typeof body.autoCreateProjectFolder !== 'boolean')) fail('資料夾設定不正確，請重新選擇資料夾');
      return await withDrive(env, workspace, body.revision, fetchFn, async ctx => {
        if (path.endsWith('/save')) return save(ctx, body);
        const item = (await ctx.graph(itemPath(ctx.row, body.folderId))).data;
        const folder = {...folderMetadata(item, ctx.row), autoCreateProjectFolder: body.autoCreateProjectFolder};
        const revision = crypto.randomUUID();
        const changed = await sql(env, `UPDATE onedrive_bindings SET folder_json=?4,revision=?5
          WHERE workspace_id=?1 AND revision=?2 AND lease_id=?3 AND lease_until>?6 RETURNING workspace_id`,
          workspace, ctx.row.revision, ctx.lease, JSON.stringify(folder), revision, Date.now()).first();
        if (!changed) fail('OneDrive 綁定已變更，請重新載入設定後再試', 409);
        ctx.row.revision = revision;
        ctx.row.folder_json = JSON.stringify(folder);
        return response(status(ctx.row));
      });
    }
    fail('找不到指定的 OneDrive 功能', 404);
  } catch (error) {
    if (error instanceof OneDriveBindingError) throw error;
    fail('OneDrive 帳號綁定操作失敗，請稍後再試', 500);
  }
}
