(() => {
  'use strict';
  const API='https://kino-quotation-data-api.film-kinostudio.workers.dev';
  const $=id=>document.getElementById(id),names=['clientCompany','clientContact','clientTaxId','clientPhone'];
  for(const type of ['contextmenu','dragstart','selectstart'])$('brand').addEventListener(type,event=>event.preventDefault());
  const token=/^\/s\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname)?.[1];
  let fixed,kind='handwritten',ink=false,upload='',previewBody,submitted,blobUrl,busy=false,locked=false;
  const canvas=$('canvas'),ctx=canvas.getContext('2d');
  let snackbarTimer;
  const closeSnackbar=()=>{$('snackbar').hidden=true;clearTimeout(snackbarTimer);};
  $('snackbar-close').onclick=closeSnackbar;
  const notice=(text,error=false)=>{
    closeSnackbar();
    if(error){$('notice').textContent=$('form').hidden?text:'';$('snackbar').hidden=false;$('snackbar-message').textContent=text;snackbarTimer=setTimeout(closeSnackbar,8000);}
    else $('notice').textContent=text;
  };
  const storageKey=()=>`kino_quote_submission_${fixed.id}`;
  function invalidate() {previewBody=null;$('review').hidden=true;$('consent').checked=false;$('confirm').disabled=true;if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}}
  async function request(path='',body) {
    const response=await fetch(API+'/api/signing/guest'+path,{method:body?'POST':'GET',headers:{Authorization:'Quote '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(90000)});
    if(!response.ok) {const error=await response.json().catch(()=>({}));throw new Error(error.error||'暫時無法完成，請稍後再試。');}
    return response;
  }
  async function action(fn) {
    if(busy)return;busy=true;document.body.setAttribute('aria-busy','true');
    const controls=[...document.querySelectorAll('button,input')],disabled=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);
    try {await fn();} catch(error){notice(['TypeError','TimeoutError','AbortError'].includes(error.name)?'連線中斷或逾時，請稍後重試；已送出時請使用原內容重試。':error.message||'暫時無法完成，請稍後重試。',true);}
    finally {controls.forEach((c,i)=>c.disabled=disabled[i]);busy=false;document.body.removeAttribute('aria-busy');$('confirm').disabled=!previewBody||!$('consent').checked||locked;}
  }
  async function showPdf(response) {
    const blob=await response.blob();if(!blob.type.includes('application/pdf')||blob.size>12*1024*1024)throw new Error('PDF 回應格式不正確。');
    const expected=response.headers.get('x-content-sha256');
    if(expected){const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==expected)throw new Error('PDF 完整性核對失敗，請重試。');}
    if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=URL.createObjectURL(blob);$('open-pdf').href=blobUrl;$('pdf').src=blobUrl;
  }
  function done() {
    sessionStorage.removeItem(storageKey());submitted=null;locked=true;invalidate();$('form').hidden=true;$('retry').hidden=true;$('done').hidden=false;notice('簽署完成，請下載已簽 PDF 留存。');
  }
  async function send() {
    const result=await (await request('',submitted)).json();
    if(result.status==='signed')done();else notice('已收到簽署，正在產生 PDF。請稍候再按「查詢／重試本次送出」。');
  }
  $('form').addEventListener('input',()=>{if(!locked)invalidate();});
  for(const mode of ['handwritten','stamp']) $(mode).onclick=()=>{
    if(locked||busy)return;kind=mode;invalidate();
    $('handwritten').setAttribute('aria-pressed',String(mode==='handwritten'));$('stamp').setAttribute('aria-pressed',String(mode==='stamp'));
    $('draw-area').hidden=mode!=='handwritten';$('upload-area').hidden=mode!=='stamp';
  };
  let pointer=null;
  const point=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];};
  canvas.onpointerdown=e=>{
    if(locked||busy||pointer!==null)return;e.preventDefault();invalidate();pointer=e.pointerId;canvas.setPointerCapture(pointer);
    const [x,y]=point(e);ctx.strokeStyle=ctx.fillStyle='#18334a';ctx.lineWidth=3;ctx.lineCap=ctx.lineJoin='round';ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(x,y);ink=true;
  };
  canvas.onpointermove=e=>{if(pointer!==e.pointerId||busy||locked)return;invalidate();const [x,y]=point(e);ctx.lineTo(x,y);ctx.stroke();};
  canvas.onpointerup=canvas.onpointercancel=()=>{pointer=null;};
  $('clear').onclick=()=>{if(locked)return;ctx.clearRect(0,0,canvas.width,canvas.height);ink=false;invalidate();};
  const selectImage=input=>action(async()=>{
    invalidate();upload='';$('stamp-image').hidden=true;
    const file=input.files[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw new Error('請選擇 8 MB 以內的 PNG、JPG 或 WebP。');
    const url=URL.createObjectURL(file),image=new Image();
    try {image.src=url;await image.decode();if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>16000000)throw new Error('圖片尺寸過大，請縮小後再上傳。');
      const scale=Math.min(1,1200/Math.max(image.naturalWidth,image.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.naturalWidth*scale));c.height=Math.max(1,Math.round(image.naturalHeight*scale));c.getContext('2d').drawImage(image,0,0,c.width,c.height);upload=c.toDataURL('image/png');
      $('stamp-image').src=upload;$('stamp-image').hidden=false;
    } finally {URL.revokeObjectURL(url);input.value='';}
  });
  $('file').onchange=()=>selectImage($('file'));
  $('camera').onchange=()=>selectImage($('camera'));
  $('form').onsubmit=e=>{e.preventDefault();void action(async()=>{
    if(locked)return;pointer=null;invalidate();
    const body=Object.fromEntries(names.map(name=>[name,$('form').elements[name].value.trim()]));
    if(!body.clientCompany&&!body.clientContact)throw new Error('請填寫公司／抬頭或姓名。');
    if(kind==='handwritten'&&!ink||kind==='stamp'&&!upload)throw new Error('請先手寫簽名或上傳簽名／印章。');
    const fields={snapshotSha256:fixed.snapshotSha256,...body,signatureKind:kind,signatureImage:kind==='handwritten'?canvas.toDataURL('image/png'):upload};
    notice('正在產生填寫後的預覽，尚未送出簽署…');await showPdf(await request('/preview',fields));previewBody=fields;$('review-title').textContent='確認簽署內容';$('consent').closest('label').hidden=false;$('confirm').hidden=false;$('review').hidden=false;notice('預覽已完成。請核對完整 PDF，勾選同意後才送出。');$('review').scrollIntoView({behavior:'smooth',block:'start'});
  });};
  $('consent').onchange=()=>{$('confirm').disabled=!previewBody||!$('consent').checked||locked;};
  $('confirm').onclick=()=>action(async()=>{
    if(!previewBody||!$('consent').checked||locked)return;
    submitted={...previewBody,idempotencyKey:crypto.randomUUID(),consent:true};
    // Preserve the identical confirmed request across reloads; clear it after success.
    sessionStorage.setItem(storageKey(),JSON.stringify(submitted));locked=true;$('form').hidden=true;$('review').hidden=true;$('retry').hidden=false;
    notice('正在提交簽署，請勿關閉頁面…');await send();
  });
  $('retry-submit').onclick=()=>action(async()=>{
    if(submitted)await send();else {const state=await(await request()).json();if(state.status==='signed')done();else notice('仍在處理中，請稍候重試。');}
  });
  $('original').onclick=()=>action(async()=>{invalidate();await showPdf(await request('/preview'));$('review-title').textContent='完整報價內容';$('review').hidden=false;$('consent').closest('label').hidden=true;$('confirm').hidden=true;});
  $('download').onclick=()=>action(async()=>{
    await showPdf(await request('/pdf'));const link=document.createElement('a');link.href=blobUrl;link.download=(fixed.snapshot.quotation.header.quotationId||'quotation').replace(/[\\/:*?"<>|\x00-\x1f]/g,'-')+'.pdf';document.body.append(link);link.click();link.remove();notice('已下載固定版本；開啟 PDF 後即可列印。');
  });
  void action(async()=>{
    if(!token)throw new Error('簽署連結不完整，請向報價方索取完整連結。');
    fixed=await(await request()).json();const q=fixed.snapshot.quotation;
    $('quote-title').textContent=q.header.quotationId;$('quote-meta').textContent=`${q.project.map(p=>p.value).filter(Boolean).slice(0,2).join(' · ')}｜連結期限：${new Date(fixed.expiresAt).toLocaleDateString('zh-TW')}`;$('quote').hidden=false;
    if(fixed.status==='signed')return done();
    const saved=sessionStorage.getItem(storageKey());if(saved)submitted=JSON.parse(saved);
    if(submitted||fixed.status==='submitting'){locked=true;$('retry').hidden=false;notice('這份報價已有送出紀錄，請查詢／重試原簽署。');return;}
    if(!fixed.canSubmit){notice('此報價尚未開放線上簽署，可先閱讀 PDF。');return;}
    names.forEach(name=>{$('form').elements[name].value=q.signature[name]||'';});$('form').hidden=false;notice('請先閱讀完整報價，再填寫甲方資料與簽名。');
  });
})();
