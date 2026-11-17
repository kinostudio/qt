/* Browser-local migration only. No requests or authentication tokens. */
(() => {
    'use strict';
    const prefix='kino_quotation_';
    const names=['draft_v2','project_library_v1','contract_templates_v1','clause_library_v1','clause_categories_v1','stamp_assets_v1','deleted_projects_v1','deleted_templates_v1','deleted_clauses_v1','deleted_clause_categories_v1','deleted_stamps_v1','onedrive_folder_v1','onedrive_parent_folder_v1','onedrive_auto_create_folder_v1','onedrive_autosave_v1','print_scale_v1','desktop_toolbar_expanded','mobile_toolbar_expanded','cloud_last_auth_user_v1'];
    const keys=names.map(name=>prefix+name);
    const object=v=>v && typeof v==='object' && !Array.isArray(v);
    const snapshot=storage=>Object.fromEntries(keys.map(key=>[key,storage.getItem(key)]).filter(([,v])=>v!==null));
    const hash=async entries=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(entries).sort(([a],[b])=>a.localeCompare(b)))))))).map(v=>v.toString(16).padStart(2,'0')).join('');
    function validate(entries) {
        if(!object(entries) || Object.keys(entries).some(key=>!keys.includes(key))) throw new Error('備份含有不支援的資料，未寫入任何內容。');
        const parsed={};
        for(const [key,raw] of Object.entries(entries)) {
            if(typeof raw!=='string') throw new Error('備份資料格式錯誤。');
            try{parsed[key.slice(prefix.length)]=JSON.parse(raw);}catch{throw new Error('備份內有無法解析的資料。');}
        }
        const quote=value=>{
            if(!object(value)) throw new Error('備份內的報價格式錯誤。');
            for(const key of ['header','signature','payment','items','printSettings','bank']) if(key in value && !object(value[key])) throw new Error('備份內的報價設定格式錯誤。');
            for(const key of ['project','categories','notes']) if(key in value && !Array.isArray(value[key])) throw new Error('備份內的報價清單格式錯誤。');
            if(value.project?.some(field=>!object(field) || typeof field.label!=='string' || typeof field.value!=='string')) throw new Error('專案概況格式錯誤。');
            if(value.categories?.some(category=>!object(category) || typeof category.id!=='string' || typeof category.name!=='string')) throw new Error('報價分類格式錯誤。');
            if(value.notes?.some(note=>typeof note!=='string' && (!object(note) || typeof note.text!=='string'))) throw new Error('報價條款格式錯誤。');
            if(value.items && Object.values(value.items).some(items=>!Array.isArray(items) || items.some(item=>!object(item)))) throw new Error('備份內的服務細項格式錯誤。');
            if(value.payment?.terms && !Array.isArray(value.payment.terms)) throw new Error('備份內的付款方式格式錯誤。');
        };
        for(const name of ['project_library_v1','contract_templates_v1','clause_library_v1','clause_categories_v1','stamp_assets_v1']) if(name in parsed && (!Array.isArray(parsed[name]) || parsed[name].some(v=>!object(v) || !v.id))) throw new Error('備份內的資料庫格式錯誤。');
        if('draft_v2' in parsed) quote(parsed.draft_v2);
        for(const record of parsed.project_library_v1 || []) quote(record.data);
        for(const record of parsed.contract_templates_v1 || []) if(!Array.isArray(record.notes)) throw new Error('條款範本格式錯誤。');
        for(const record of parsed.clause_library_v1 || []) if(typeof record.text!=='string' || typeof record.category!=='string') throw new Error('條款內容格式錯誤。');
        for(const record of parsed.clause_categories_v1 || []) if(typeof record.name!=='string') throw new Error('條款分類格式錯誤。');
        for(const name of ['onedrive_folder_v1','onedrive_parent_folder_v1','cloud_last_auth_user_v1']) if(name in parsed && parsed[name]!==null && !object(parsed[name])) throw new Error('帳號提示或目錄設定格式錯誤。');
        for(const name of names.filter(name=>name.startsWith('deleted_'))) if(name in parsed && (!Array.isArray(parsed[name]) || parsed[name].some(v=>typeof v!=='string'))) throw new Error('刪除紀錄格式錯誤。');
        for(const name of ['onedrive_auto_create_folder_v1','onedrive_autosave_v1','desktop_toolbar_expanded','mobile_toolbar_expanded']) if(name in parsed && typeof parsed[name]!=='boolean') throw new Error('備份設定格式錯誤。');
        if('print_scale_v1' in parsed && (!Number.isFinite(Number(parsed.print_scale_v1)) || Number(parsed.print_scale_v1)<70 || Number(parsed.print_scale_v1)>100)) throw new Error('列印比例格式錯誤。');
        for(const asset of parsed.stamp_assets_v1 || []) if(!asset.dataUrl) throw new Error('有印章圖片尚未下載到本機，請先完成同步再備份。');
        const assets=new Map((parsed.stamp_assets_v1 || []).map(asset=>[asset.id,asset]));
        for(const data of [parsed.draft_v2,...(parsed.project_library_v1 || []).map(p=>p.data)].filter(Boolean)) for(const key of ['clientStamp','vendorStamp']) {
            const stamp=data.signature?.[key];
            if(stamp?.assetId && !stamp.sourceDataUrl && !assets.get(stamp.assetId)?.dataUrl) throw new Error('報價引用的印章圖片尚未備齊，請先完成同步再備份。');
        }
        return parsed;
    }
    const summary=entries=>{
        const p=validate(entries);
        return {draft:Boolean(p.draft_v2),projects:p.project_library_v1?.length || 0,templates:p.contract_templates_v1?.length || 0,categories:p.clause_categories_v1?.length || 0,clauses:p.clause_library_v1?.length || 0,stamps:p.stamp_assets_v1?.length || 0};
    };
    async function create(storage,origin) {
        const entries=snapshot(storage);
        validate(entries);
        return {kind:'kino-qt-local-backup',version:1,createdAt:new Date().toISOString(),sourceOrigin:origin,entries,checksum:await hash(entries)};
    }
    async function inspect(text) {
        if(typeof text!=='string' || text.length>20*1024*1024) throw new Error('備份超過 20 MB 或格式錯誤。');
        let backup;
        try{backup=JSON.parse(text);}catch{throw new Error('不是有效的 JSON 備份檔。');}
        if(backup?.kind!=='kino-qt-local-backup' || backup.version!==1) throw new Error('請選擇「完整本機備份」，不是單一報價 JSON。');
        const counts=summary(backup.entries);
        if(await hash(backup.entries)!==backup.checksum) throw new Error('備份檢查碼不符，檔案可能不完整；未寫入任何內容。');
        return {backup,counts};
    }
    async function restore(storage,text,expectedCurrentChecksum) {
        const {backup}=await inspect(text);
        const previous=snapshot(storage);
        if(await hash(previous)!==expectedCurrentChecksum) throw new Error('目前本機資料已變更，請重新備份並確認後再還原。');
        const write=entries=>{
            for(const key of keys) storage.removeItem(key);
            for(const [key,value] of Object.entries(entries)) storage.setItem(key,value);
        };
        try {
            write({...backup.entries,[prefix+'onedrive_autosave_v1']:'false'});
        } catch(error) {
            try{write(previous);}catch{throw new Error('瀏覽器儲存空間異常，無法完整回復；請保留備份檔並停止編輯。');}
            throw new Error('無法還原（可能儲存空間不足），已回復還原前的本機內容。');
        }
        return summary(backup.entries);
    }
    window.KinoLocalBackup=Object.freeze({create,inspect,restore,summary});
})();
