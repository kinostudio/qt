(() => {
  'use strict';
  let current;
  const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const date=value=>value?new Date(value).toLocaleString('zh-TW'):'';
  const status=row=>row.revokedAt?'連結已撤銷':row.status==='signed'?'已簽署':row.status==='submitting'?'產檔中':row.expiresAt<=Date.now()?'連結已到期':'等待客戶簽署';
  const safeLink=value=>{const url=new URL(value);if(url.origin!=='https://quote.kinostudio.tw'||!/^\/s\/[A-Za-z0-9_-]{43}$/.test(url.pathname))throw new Error('簽署連結格式不正確');return url.href;};
  window.KinoSigningManager={close(){current?.close();},open({request,binary}){
    this.close();
    const dialog=element('dialog');current=dialog;dialog.className='qt-signing-manager';dialog.setAttribute('aria-label','客戶簽署管理');
    dialog.innerHTML=`<header><h2>客戶簽署管理</h2><button type="button" data-action="close" aria-label="關閉簽署管理">✕</button></header>
      <div class="qt-signing-body"><p role="status" aria-live="polite">正在載入簽署紀錄…</p>
      <section><h3>建立本份報價的待簽版本</h3><p>先產生固定 PDF 並核對金額、條款與乙方資料。建立後，修改草稿不會變更客戶收到的版本。</p>
      <button type="button" data-action="prepare">準備固定版本並預覽</button>
      <div data-area="prepared" hidden><p data-area="summary"></p><a data-area="pdf-link" target="_blank" rel="noopener noreferrer">開啟固定 PDF 預覽</a><iframe title="待簽固定版本預覽"></iframe>
      <label>連結有效天數 <input data-area="days" type="number" min="1" max="30" step="1" value="14"></label>
      <label class="qt-signing-check"><input type="checkbox" data-area="confirmed">我已閱讀固定 PDF，確認金額、條款及乙方資料正確，建立這個版本的客戶簽署連結。</label>
      <button type="button" data-action="create" disabled>建立客戶簽署連結</button></div><div data-area="detail"></div></section>
      <section><div class="qt-signing-heading"><h3>本帳號的簽署紀錄</h3><button type="button" data-action="refresh">重新整理狀態</button></div><div data-area="list"></div>
      <div class="qt-signing-pager"><button type="button" data-action="previous">上一頁</button><button type="button" data-action="next">下一頁</button></div></section></div>`;
    const area=name=>dialog.querySelector(`[data-area="${name}"]`),button=name=>dialog.querySelector(`[data-action="${name}"]`),notice=dialog.querySelector('[role="status"]');
    let snapshot,blobUrl,offset=0,nextOffset=null,busy=false,closed=false;
    const message=(text,error=false)=>{notice.textContent=text;notice.classList.toggle('error',error);};
    const release=()=>{if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}};
    dialog.addEventListener('close',()=>{closed=true;release();dialog.remove();if(current===dialog)current=null;});
    button('close').onclick=()=>dialog.close();
    const run=async fn=>{
      if(busy||closed)return;busy=true;dialog.setAttribute('aria-busy','true');
      const controls=[...dialog.querySelectorAll('button,input')],disabled=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);
      try{await fn();}catch(error){message(error.message==='SYNC_CANCELLED'?'請先使用 Google 登入。':error.message||'操作失敗，請重試。',true);}
      finally{controls.forEach((c,i)=>c.disabled=disabled[i]);busy=false;dialog.removeAttribute('aria-busy');button('create').disabled=!snapshot||!area('confirmed').checked;button('previous').disabled=offset===0;button('next').disabled=nextOffset===null;if(closed)release();}
    };
    const download=async row=>{
      const blob=await binary(`/api/signing/${row.id}/pdf`);if(!blob.type.includes('application/pdf'))throw new Error('已簽 PDF 格式不正確');
      const url=URL.createObjectURL(blob),link=element('a');link.href=url;link.download=String(row.quotationId||'quotation').replace(/[\\/:*?"<>|\x00-\x1f]/g,'-')+'.pdf';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);message('已下載固定已簽 PDF，與客戶取得的檔案相同。');
    };
    function showLink(record) {
      area('detail').replaceChildren();
      if(!record.url){area('detail').append(element('p','此舊連結無法重新取得；原連結仍依原有效期限運作。請建立新的待簽版本。'));return;}
      const url=safeLink(record.url),label=element('label','客戶專用連結（請勿公開轉貼）'),input=element('input');input.readOnly=true;input.value=url;input.setAttribute('aria-label','客戶專用連結');label.append(input);
      const copy=element('button','複製連結');copy.type='button';copy.onclick=()=>run(async()=>{await navigator.clipboard.writeText(url);message('客戶連結已複製。');});
      area('detail').append(label,element('p',`有效至 ${date(record.expiresAt)}。此連結不會開啟編輯台；到期或撤銷後不可存取。`),copy);
    }
    async function load() {
      const result=await request('/api/signing?offset='+offset);nextOffset=result.nextOffset;area('list').replaceChildren();
      for(const row of result.items){
        const card=element('article'),title=element('h4',row.quotationId||'未命名報價');card.append(title,element('p',`${status(row)}｜建立：${date(row.createdAt)}｜有效至：${date(row.expiresAt)}`));
        const actions=element('div');actions.className='qt-signing-actions';
        if(!row.revokedAt&&row.expiresAt>Date.now()) {const view=element('button','查看／複製連結');view.type='button';view.onclick=()=>run(async()=>showLink(await request('/api/signing/'+row.id)));actions.append(view);}
        if(row.status==='signed'){const save=element('button','下載已簽 PDF');save.type='button';save.onclick=()=>run(()=>download(row));actions.append(save);}
        if(!row.revokedAt){const revoke=element('button','撤銷客戶連結');revoke.type='button';let confirm=false;revoke.onclick=()=>{if(!confirm){confirm=true;revoke.textContent='確認撤銷（保留已簽檔）';return;}void run(async()=>{await request('/api/signing/'+row.id,{method:'DELETE'});area('detail').replaceChildren();await load();message('客戶連結已撤銷，原始快照與已簽 PDF 仍保留。');});};actions.append(revoke);}
        card.append(actions);area('list').append(card);
      }
      if(!result.items.length)area('list').append(element('p','目前沒有簽署紀錄。'));
      button('previous').disabled=offset===0;button('next').disabled=nextOffset===null;
    }
    area('confirmed').onchange=()=>{button('create').disabled=!snapshot||!area('confirmed').checked;};
    button('prepare').onclick=()=>run(async()=>{
      snapshot=null;area('confirmed').checked=false;area('prepared').hidden=true;release();message('正在固定目前報價並產生預覽，尚未建立客戶連結…');
      const captured=await new Promise((resolve,reject)=>window.dispatchEvent(new CustomEvent('quotation-signing-snapshot',{detail:{resolve,reject}})));
      const blob=await binary('/api/pdf',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...captured.printDocument,editableClientFields:false})});
      if(!blob.type.includes('application/pdf'))throw new Error('固定 PDF 預覽格式不正確');
      snapshot=captured;blobUrl=URL.createObjectURL(blob);area('pdf-link').href=blobUrl;dialog.querySelector('iframe').src=blobUrl;
      area('summary').textContent=`報價單號：${captured.quotation.header.quotationId}｜${captured.quotation.quotationType==='quick'?'快速報價':'詳細報價'}｜列印比例 ${captured.printScale}%`;
      area('prepared').hidden=false;message('固定版本已備妥。請開啟完整 PDF 核對，再勾選確認。');
    });
    button('create').onclick=()=>run(async()=>{
      if(!snapshot||!area('confirmed').checked)return;
      const days=Number(area('days').value);if(!Number.isInteger(days)||days<1||days>30)throw new Error('連結有效天數須為1–30天。');
      let record;
      try{record=await request('/api/signing',{method:'POST',body:JSON.stringify({confirmed:true,snapshot,lifetimeDays:days})});}
      catch(error){if(error.status===429)throw error;snapshot=null;area('prepared').hidden=true;release();await load().catch(()=>{});throw new Error((error.message||'連線失敗')+'。請先重新整理簽署紀錄確認是否已建立，避免重複建立。');}
      snapshot=null;area('prepared').hidden=true;release();showLink(record);offset=0;await load();message('已建立不可隨草稿變動的待簽版本。可將專用連結傳給客戶。');
    });
    button('refresh').onclick=()=>run(async()=>{await load();message('簽署狀態已更新。');});
    button('previous').onclick=()=>run(async()=>{offset=Math.max(0,offset-25);await load();});
    button('next').onclick=()=>run(async()=>{if(nextOffset!==null){offset=nextOffset;await load();}});
    document.body.append(dialog);dialog.showModal();void run(async()=>{await load();message('可準備本份報價，或查看既有簽署紀錄。');});
  }};
})();
