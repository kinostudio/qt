const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const api = 'https://kino-quotation-data-api.film-kinostudio.workers.dev';
const origin = 'https://qt.kinostudio.tw';
const linkKey = 'kino_quotation_onedrive_link_v1';
const tokenKey = 'kino_quotation_cloud_auth_token';
const user = id => ({id, email:`${id}@example.invalid`, name:id});
const revision1 = '11111111-1111-4111-8111-111111111111';
const revision2 = '22222222-2222-4222-8222-222222222222';
const binding = (id, revision = revision1) => ({bound:true, revision, account:{homeAccountId:`drive-${id}`, name:id, username:`${id}@example.invalid`}, folder:{id:`folder-${id}`, name:`Folder ${id}`, path:`/${id}`, autoCreateProjectFolder:false}, needsReconnect:false});

(async () => {
    const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
    const deadline = setTimeout(() => {
        console.error('OneDrive UI test exceeded 120 seconds');
        process.exitCode = 1;
        browser.close().catch(()=>{});
    },120000);
    try {
        const context = await browser.newContext();
        const calls = [], errors = [];
        let releaseSave, holdSave = false, reauth = false, releaseStatus, holdStatus = false;
        let failFolder = false, failStatus = false, failUnlink = false, holdFolder = false, releaseFolder;
        const statuses = {A:binding('A'), B:binding('B')};
        await context.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url());
            if (url.origin === api) {
                const headers = {'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'};
                if (request.method() === 'OPTIONS') return route.fulfill({status:204, headers});
                const id = request.headers().authorization?.replace('Bearer token-', '') || 'A';
                const body = request.postData() ? JSON.parse(request.postData()) : null;
                calls.push({path:url.pathname, method:request.method(), id, body});
                let result = {}, status = 200;
                if (url.pathname === '/api/config') result = {oneDriveBindingEnabled:true, microsoftClientId:'must-not-initialize'};
                else if (url.pathname === '/api/auth/me') result = {user:user(id)};
                else if (url.pathname === '/api/auth/google') result = {user:user(body.credential), token:`token-${body.credential}`};
                else if (url.pathname === '/api/onedrive') {
                    if ((request.method() === 'DELETE' && failUnlink) || (request.method() === 'GET' && failStatus)) {
                        failUnlink = false;
                        failStatus = false;
                        status = 503;
                        result = {error:'Temporary connection failure'};
                    } else {
                        if (request.method() === 'DELETE') statuses[id] = {bound:false};
                        result = structuredClone(statuses[id]);
                    }
                    if (holdStatus) { holdStatus = false; await new Promise(resolve => { releaseStatus = resolve; }); }
                } else if (url.pathname === '/api/onedrive/complete') result = statuses[id];
                else if (url.pathname === '/api/onedrive/start') result = {state:'expected',authorizationUrl:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=expected'};
                else if (url.pathname === '/api/onedrive/folders') result = url.searchParams.has('cursor') ? {value:[{id:'page2',name:'Second page',folder:{}}]} : {value:[{id:'selected',name:'Selected',folder:{}}],nextCursor:'opaque-page-2'};
                else if (url.pathname === '/api/onedrive/folder') {
                    assert.equal(typeof body.revision,'string');
                    if (holdFolder) { holdFolder = false; await new Promise(resolve=>{releaseFolder=resolve;}); }
                    if (failFolder) {
                        failFolder = false;
                        status = 503;
                        result = {error:'Temporary folder failure'};
                    } else if (body.revision !== statuses[id].revision) {
                        status = 409;
                        result = {code:'ONEDRIVE_SETTINGS_CHANGED',error:'OneDrive settings changed'};
                    } else {
                        statuses[id] = {...binding(id, revision2), folder:{id:body.folderId, name:'Selected', path:'/Selected', autoCreateProjectFolder:body.autoCreateProjectFolder}};
                        result = statuses[id];
                    }
                } else if (url.pathname === '/api/onedrive/save') {
                    if (holdSave) { holdSave = false; await new Promise(resolve => { releaseSave = resolve; }); }
                    if (reauth) { status = 409; statuses[id] = {...statuses[id], needsReconnect:true}; result = {code:'ONEDRIVE_REAUTH_REQUIRED',error:'請重新連接 OneDrive'}; }
                    else result = {id:'saved',name:'test.json'};
                } else if (url.pathname === '/api/sync') result = {projects:[],templates:[],clauses:[],categories:[]};
                else if (url.pathname === '/api/stamps') result = {assets:[]};
                else if (url.pathname !== '/api/auth/logout') throw new Error(`Unexpected API ${url.pathname}`);
                return route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(result)});
            }
            if (url.origin === origin) {
                if (url.pathname.includes('msal-browser')) return route.fulfill({contentType:'application/javascript',body:'window.msal={PublicClientApplication:class {constructor(){throw Error("Bound mode initialized MSAL")}}}'});
                const target = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
                assert.ok(target.startsWith(root + path.sep));
                let content = fs.readFileSync(target);
                if (target.endsWith('index.html')) {
                    // Test-only access to real render closures, without production debug hooks.
                    content = content.toString().replace('const handleStampAssetsChange = nextAssets => {',
                        'window.__oneDriveTest={open:()=>setShowOneDriveModal(true),unlink:logoutOneDrive,start:startOneDriveBinding,save:saveDataToOneDrive,login:handleGoogleCredential,logout:logoutCloudAccount,refresh:async()=>{const identity=oneDriveIdentityRef.current;applyBoundOneDriveStatus(await boundOneDriveRequest("",{},identity),identity)},select:selectOneDriveFolder,setAuto:setOneDriveAutoSave,edit:()=>setData(prev=>({...prev,header:{...prev.header,quotationId:"edited"}})),account:oneDriveAccount,auto:oneDriveAutoSave}; const handleStampAssetsChange = nextAssets => {');
                }
                return route.fulfill({contentType:target.endsWith('.html')?'text/html':target.endsWith('.js')?'application/javascript':'application/octet-stream',body:content});
            }
            if (url.hostname === 'login.microsoftonline.com') return route.fulfill({contentType:'text/html',body:'Mock Microsoft consent'});
            if (url.hostname === 'unpkg.com' || url.hostname === 'cdn.tailwindcss.com') return route.continue();
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(30000);
        page.on('pageerror', error => errors.push(error.message));
        const seed = async (id, pending) => {
            await page.goto(`${origin}/onedrive-link.html`);
            await page.evaluate(({id,pending,linkKey,tokenKey}) => {
                sessionStorage.clear();
                sessionStorage.setItem(tokenKey,`token-${id}`);
                sessionStorage.setItem('kino_quotation_cloud_auth_user',JSON.stringify({id:'unverified-cache',email:'cache@example.invalid'}));
                localStorage.setItem('kino_quotation_onedrive_folder_v1',JSON.stringify({id:'legacy-A',name:'Must not adopt'}));
                localStorage.setItem('kino_quotation_onedrive_autosave_v1','true');
                if (pending) sessionStorage.setItem(linkKey,JSON.stringify(pending));
            },{id,pending,linkKey,tokenKey});
        };
        const ready = async id => {
            await page.waitForFunction(id => window.__oneDriveTest?.account?.homeAccountId === `drive-${id}`,id,{timeout:45000});
        };
        const completes = () => calls.filter(c => c.path.endsWith('/complete'));
        const writes = () => calls.filter(c => /\/(save|folder|start|complete)$/.test(c.path) && c.method === 'POST');

        for (const query of ['?code=secret&state=wrong','?code=secret']) {
            await seed('A',{userId:'A',state:'expected',verifier:'original-verifier'});
            await page.goto(`${origin}/onedrive-link.html${query}`);
            await page.getByText('OneDrive 綁定驗證失敗',{exact:false}).waitFor();
            assert.equal(new URL(page.url()).search,'');
            assert.equal(await page.evaluate(key => sessionStorage.getItem(key),linkKey),null);
            assert.equal(completes().length,0);
        }
        console.log('PASS callback rejects wrong/missing state and clears code');
        await seed('A',{userId:'A',state:'expected',verifier:'original-verifier'});
        await page.goto(`${origin}/onedrive-link.html?code=valid-code&state=expected`);
        await ready('A');
        console.log('PASS callback completes verified A');
        assert.equal(page.url(),`${origin}/`);
        assert.deepEqual(completes()[0].body,{state:'expected',code:'valid-code',verifier:'original-verifier'});
        assert.ok(calls.findIndex(c=>c.path === '/api/auth/me') < calls.findIndex(c=>c.path.endsWith('/complete')));
        assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),linkKey),null);
        await page.getByRole('button',{name:'更換',exact:true}).click();
        await page.getByRole('button',{name:'Second page',exact:true}).waitFor();
        assert.equal(calls.filter(c=>c.path === '/api/onedrive/folders').length,2);
        await page.getByRole('button',{name:'關閉 OneDrive 設定'}).click();
        const beforeRestore = writes().length;
        await page.reload();
        await ready('A');
        await page.waitForTimeout(3200);
        assert.equal(writes().length,beforeRestore,'Restoration must not write or enable autosave');
        assert.equal(await page.evaluate(()=>window.__oneDriveTest.auto),false);
        assert.equal(await page.evaluate(()=>localStorage.getItem('kino_quotation_onedrive_autosave_v1')),'true','Bound mode preserves legacy storage');

        // Explicit toggle alone is not an edit; a later edit may autosave.
        await page.evaluate(()=>window.__oneDriveTest.setAuto(true));
        await page.waitForTimeout(3200);
        assert.equal(writes().length,beforeRestore);
        await page.evaluate(()=>window.__oneDriveTest.edit());
        await page.waitForFunction(()=>window.__oneDriveTest.account && document.body.innerText.includes('OneDrive 已儲存'),null,{timeout:8000});
        const saved = calls.find(c=>c.path.endsWith('/save'));
        assert.equal(saved.body.revision,revision1);
        assert.equal(saved.body.quotationId,'edited');

        await page.evaluate(()=>window.__oneDriveTest.select({id:'selected',name:'Selected',path:'/Selected'}));
        assert.equal(calls.find(c=>c.path.endsWith('/folder')).body.revision,revision1);
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(()=>window.__oneDriveTest.auto),false);
        await page.evaluate(()=>window.__oneDriveTest.save());
        assert.equal(calls.filter(c=>c.path.endsWith('/save')).at(-1).body.revision,revision2);

        // A failed folder change restores the SAME revision, but must not revive queued writes.
        holdSave = true;
        releaseSave = null;
        await page.evaluate(()=>{window.__oneDriveTest.save(); window.__oneDriveTest.save();});
        await page.waitForFunction(()=>window.__oneDriveTest.account !== null);
        while (!releaseSave) await page.waitForTimeout(20);
        const savesBeforeSelection = calls.filter(c=>c.path.endsWith('/save')).length;
        await page.evaluate(()=>window.__oneDriveTest.open());
        await page.getByRole('button',{name:'更換',exact:true}).click();
        await page.getByRole('button',{name:'Second page',exact:true}).waitFor();
        holdFolder = true;
        failFolder = true;
        await page.getByRole('button',{name:/^使用「/}).click();
        while (!releaseFolder) await page.waitForTimeout(20);
        assert.equal(await page.getByRole('button',{name:/^使用「/}).isDisabled(),true);
        assert.equal(await page.getByRole('button',{name:'立即儲存到 OneDrive',exact:true}).count(),0,'Browser must stay open during selection');
        releaseFolder();
        await page.getByRole('button',{name:'重新讀取連線',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.__oneDriveTest.auto),false);
        releaseSave();
        await page.waitForTimeout(200);
        assert.equal(calls.filter(c=>c.path.endsWith('/save')).length,savesBeforeSelection,'Same-revision restore cannot revive queued writes');
        await page.getByRole('button',{name:/^使用「/}).click();
        await page.getByRole('button',{name:'立即儲存到 OneDrive',exact:true}).waitFor();
        await page.getByRole('button',{name:'立即儲存到 OneDrive',exact:true}).click();
        await page.waitForTimeout(100);
        assert.equal(calls.filter(c=>c.path.endsWith('/save')).length,savesBeforeSelection+1,'Explicit retry saves after 503 recovery');

        // If the recovery GET also fails, offer a visible retry without forcing OAuth.
        await page.getByRole('button',{name:'更換',exact:true}).click();
        await page.getByRole('button',{name:'Second page',exact:true}).waitFor();
        failFolder = true;
        failStatus = true;
        await page.getByRole('button',{name:/^使用「/}).click();
        await page.getByText('無法重新讀取 OneDrive 連線，請按「重新讀取連線」重試。',{exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'登入 Microsoft／OneDrive',exact:true}).count(),0);
        await page.getByRole('button',{name:'重新讀取連線',exact:true}).click();
        await page.waitForFunction(()=>!document.body.innerText.includes('無法重新讀取 OneDrive 連線'));
        await page.getByRole('button',{name:/^使用「/}).click();
        await page.getByRole('button',{name:'立即儲存到 OneDrive',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.__oneDriveTest.auto),false);
        await page.getByRole('button',{name:'關閉 OneDrive 設定'}).click();

        // A failed unlink also invalidates old queued writes despite same-revision recovery.
        holdSave = true;
        releaseSave = null;
        failUnlink = true;
        await page.evaluate(()=>{window.__oneDriveTest.save(); window.__oneDriveTest.save();});
        while (!releaseSave) await page.waitForTimeout(20);
        const savesBeforeUnlink = calls.filter(c=>c.path.endsWith('/save')).length;
        page.once('dialog',dialog=>dialog.accept());
        await page.evaluate(()=>window.__oneDriveTest.unlink());
        releaseSave();
        await page.waitForTimeout(200);
        assert.equal(calls.filter(c=>c.path.endsWith('/save')).length,savesBeforeUnlink);
        assert.equal(await page.evaluate(()=>window.__oneDriveTest.auto),false);
        console.log('PASS folder 503 recovery, pending selection UI, visible GET retry, and same-revision queue invalidation on selection/unlink');

        // An A write may finish; the queued A write must not run under B's token.
        holdSave = true;
        await page.evaluate(()=>{window.__oneDriveTest.save(); window.__oneDriveTest.save();});
        await page.waitForTimeout(200);
        assert.ok(releaseSave);
        const saveCount = calls.filter(c=>c.path.endsWith('/save')).length;
        await page.evaluate(()=>window.__oneDriveTest.login('B'));
        await ready('B');
        releaseSave();
        await page.waitForTimeout(350);
        assert.equal(calls.filter(c=>c.path.endsWith('/save')).length,saveCount);
        assert.equal(await page.evaluate(()=>window.__oneDriveTest.account.homeAccountId),'drive-B');
        assert.equal(await page.evaluate(()=>window.__oneDriveTest.auto),false);

        // Old GET status must not repopulate the view after logout.
        holdStatus = true;
        await page.evaluate(()=>{window.__oneDriveTest.refresh().catch(()=>{});});
        await page.waitForTimeout(100);
        await page.evaluate(()=>window.__oneDriveTest.logout());
        releaseStatus();
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(()=>window.__oneDriveTest.account),null);

        // Callback handoff for A cannot complete while Google verifies B.
        await seed('B',{userId:'A',state:'expected',verifier:'original-verifier'});
        const completed = completes().length;
        await page.goto(`${origin}/onedrive-link.html?code=not-for-B&state=expected`);
        await ready('B');
        assert.equal(completes().length,completed);
        assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),linkKey),null);

        // No completion without the original verifier, even for the same Google user.
        await seed('B',{userId:'B',state:'expected',code:'unproven'});
        await page.goto(`${origin}/`);
        await ready('B');
        assert.equal(completes().length,completed);
        assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),linkKey),null);

        await Promise.all([
            page.waitForURL('https://login.microsoftonline.com/**'),
            page.evaluate(()=>window.__oneDriveTest.start())
        ]);
        await page.goto(`${origin}/onedrive-link.html?state=expected&code=pkce-code`);
        await ready('B');
        const started = calls.find(c=>c.path.endsWith('/start'));
        const proof = completes().at(-1).body;
        assert.equal(proof.state,'expected');
        assert.match(proof.verifier,/^[A-Za-z0-9_-]{43}$/);
        assert.equal(createHash('sha256').update(proof.verifier).digest('base64url'),started.body.challenge);

        // Another device changed the binding: refresh, never retry the stale folder selection.
        statuses.B = binding('B',revision2);
        const folderCalls = calls.filter(c=>c.path.endsWith('/folder')).length;
        await page.evaluate(()=>window.__oneDriveTest.select({id:'stale-selection',name:'Stale',path:'/Stale'}));
        assert.equal(calls.filter(c=>c.path.endsWith('/folder')).length,folderCalls+1);
        assert.equal(await page.evaluate(()=>window.__oneDriveTest.auto),false);
        await page.evaluate(()=>window.__oneDriveTest.save());
        assert.equal(calls.filter(c=>c.path.endsWith('/save')).at(-1).body.revision,revision2);

        reauth = true;
        await page.evaluate(()=>window.__oneDriveTest.save());
        assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),tokenKey),'token-B');
        assert.equal(await page.evaluate(()=>window.__oneDriveTest.auto),false);
        assert.ok(calls.filter(c=>c.path === '/api/onedrive' && c.id === 'B').length >= 2);
        assert.deepEqual(errors,[]);
        console.log('PASS callback state/PKCE handoff, verified identity, zero-write restore, explicit autosave, folder revision, queued-write isolation, stale responses, Microsoft reauth retains Google session');
        await context.close();
    } finally { clearTimeout(deadline); await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
