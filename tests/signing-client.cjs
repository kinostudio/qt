const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');

(async()=>{
  const {signingBody}=await import('./fixtures/signing.mjs');
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
    const token='A'.repeat(43),apiCalls=[],submissions=[],errors=[];let status='pending',failFirst=true;
    page.on('pageerror',error=>errors.push(error.message));
    const pdf=process.env.SIGNING_CLIENT_PDF?fs.readFileSync(process.env.SIGNING_CLIENT_PDF):Buffer.from('%PDF-1.7\nMOCK-RESPONSE-NOT-LAYOUT-ACCEPTANCE\n%%EOF');
    const fixed={id:'mock-share-id',snapshotSha256:'a'.repeat(64),snapshot:signingBody().snapshot,expiresAt:Date.now()+86400000,canSubmit:true};
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin==='https://quote.test') {
        const file=url.pathname.startsWith('/s/')?'index.html':url.pathname.slice(1);
        assert.ok(['index.html','app.css','app.js'].includes(file));
        return route.fulfill({body:fs.readFileSync(path.join('signing-client',file)),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
      }
      assert.equal(url.origin,'https://kino-quotation-data-api.film-kinostudio.workers.dev');
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'https://quote.test','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'}});
      assert.equal(request.headers().authorization,'Quote '+token);
      assert.equal(request.headers().referer,undefined,'Share URL must not leak via referrer');
      apiCalls.push(request.method()+' '+url.pathname);
      const headers={'access-control-allow-origin':'https://quote.test','access-control-expose-headers':'x-content-sha256'};
      if(request.method()==='GET'&&url.pathname.endsWith('/guest'))return route.fulfill({json:{...fixed,status},headers});
      if(url.pathname.endsWith('/preview')||url.pathname.endsWith('/pdf'))return route.fulfill({body:pdf,contentType:'application/pdf',headers:{...headers,'x-content-sha256':createHash('sha256').update(pdf).digest('hex')}});
      assert.equal(request.method(),'POST');assert.ok(url.pathname.endsWith('/guest'));
      submissions.push(JSON.parse(request.postData()));
      if(failFirst){failFirst=false;status='submitting';return route.abort('failed');}
      status='signed';return route.fulfill({json:{status:'signed'},headers});
    });
    await page.goto('https://quote.test/s/'+token);
    await page.locator('#form').waitFor();
    await page.locator('#original').click();await page.locator('#review').waitFor();
    assert.equal(await page.locator('#confirm').isVisible(),false);
    await page.getByLabel('公司／抬頭',{exact:true}).fill('測試甲方');
    await page.locator('#preview').click();await page.getByRole('status').filter({hasText:'請先手寫'}).waitFor();
    await page.locator('#canvas').scrollIntoViewIfNeeded();const box=await page.locator('#canvas').boundingBox();
    await page.mouse.move(box.x+30,box.y+40);await page.mouse.down();await page.mouse.move(box.x+100,box.y+65);await page.mouse.up();
    await page.locator('#preview').click();await page.getByRole('status').filter({hasText:'預覽已完成'}).waitFor();
    assert.equal(await page.locator('#confirm').isVisible(),true);assert.equal(await page.locator('#confirm').isEnabled(),false);
    assert.equal(submissions.length,0,'Preview must not submit');
    await page.getByLabel('姓名／代表人',{exact:true}).fill('修改後姓名');assert.equal(await page.locator('#review').isVisible(),false);
    await page.locator('#stamp').click();
    const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=180;c.height=120;const x=c.getContext('2d');x.strokeStyle=x.fillStyle='#b91c1c';x.lineWidth=4;x.strokeRect(5,5,170,110);x.font='24px sans-serif';x.fillText('TEST STAMP',12,70);return c.toDataURL().split(',')[1];}),'base64');
    await page.locator('#file').setInputFiles({name:'stamp.png',mimeType:'image/png',buffer:png});
    await page.locator('#stamp-image').waitFor();
    await page.locator('#preview').click();await page.getByRole('status').filter({hasText:'預覽已完成'}).waitFor();
    await page.screenshot({path:'tmp/signing-client-form-mobile.png',fullPage:true});
    await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'tmp/signing-client-form-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});
    await page.locator('#consent').check();await page.locator('#confirm').click();
    await page.getByRole('status').filter({hasText:/Failed to fetch|連線|fetch/i}).waitFor();
    assert.equal(await page.locator('#retry').isVisible(),true);assert.equal(submissions.length,1);
    const first=submissions[0];assert.equal(first.clientContact,'修改後姓名');assert.equal(first.signatureKind,'stamp');assert.equal(first.consent,true);
    await page.reload();await page.locator('#retry').waitFor();await page.locator('#retry-submit').click();await page.locator('#done').waitFor();
    assert.deepEqual(submissions[1],first,'Reload retry must retain exact confirmed content and idempotency key');
    assert.equal(await page.evaluate(()=>sessionStorage.length),0);
    const download=page.waitForEvent('download');await page.locator('#download').click();assert.equal((await download).suggestedFilename(),'TEST-ONLY-001.pdf');
    assert.equal(await page.locator('#form').isVisible(),false);assert.deepEqual(errors,[]);
    assert.ok(apiCalls.every(c=>c.includes('/api/signing/guest')));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile horizontal overflow');
    await page.screenshot({path:'tmp/signing-client-mobile.png',fullPage:true});
    await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'tmp/signing-client-desktop.png',fullPage:true});
    const before=apiCalls.length;await page.goto('https://quote.test/s/incomplete');await page.getByRole('status').filter({hasText:'簽署連結不完整'}).waitFor();assert.equal(apiCalls.length,before);assert.equal(await page.locator('#form').isVisible(),false);
    console.log('PASS isolated mobile customer flow: read, draw/upload, preview invalidation, explicit consent, reload/idempotent retry, fixed PDF download; zero production requests');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
