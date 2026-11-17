import {Buffer} from 'node:buffer';
import {SigningError} from './signing-store.js';
import {prepareSigningPage,renderSigningPdf} from './signing-render.js';
import {PRINT_FONT_URL} from './pdf-render.js';

export function createSigningRenderSession(env) {
  let browserPromise,fontPromise;
  const browser=()=>browserPromise||=(async()=>{
    if(!env.PDF_BROWSER) throw new SigningError('簽署產檔服務尚未啟用',503);
    try {const {default:puppeteer}=await import('@cloudflare/puppeteer');return await puppeteer.launch(env.PDF_BROWSER,{keep_alive:10000});}
    catch {throw new SigningError('簽署產檔服務暫時無法使用',503);}
  })();
  const font=()=>fontPromise||=(async()=>{
    const response=await fetch(PRINT_FONT_URL,{signal:AbortSignal.timeout(15000),cf:{cacheTtl:86400}});
    if(!response.ok || Number(response.headers.get('content-length'))>16*1024*1024) throw new SigningError('列印字型無法載入',503);
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength>16*1024*1024) throw new SigningError('列印字型超過上限',503);
    return 'data:font/ttf;base64,'+Buffer.from(bytes).toString('base64');
  })();
  return {
    async validateImage(_image,{snapshot,submission}) {
      const page=await (await browser()).newPage();
      try {await prepareSigningPage(page,snapshot,submission,await font());}
      catch(error) {
        if(error instanceof SigningError) throw error;
        if(/SIGNING_CLIENT_TEXT_TOO_LONG/.test(error.message)) throw new SigningError('甲方資料過長，請縮短後重新預覽',400);
        if(/IMAGE|decode|EncodingError/i.test(error.message)) throw new SigningError('簽名或圖片無法解析，請重新上傳',400);
        throw new SigningError('固定列印版型無法讀取，請聯絡報價方',503);
      } finally {await page.close().catch(()=>{});}
    },
    async renderPdf({snapshot,submission}) {
      const page=await (await browser()).newPage();
      try {return await renderSigningPdf(page,snapshot,submission,await font());}
      finally {await page.close().catch(()=>{});}
    },
    async close() {const active=await browserPromise?.catch(()=>null);if(active) await active.close().catch(()=>{});}
  };
}
