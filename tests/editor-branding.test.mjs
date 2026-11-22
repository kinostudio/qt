import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('editor and home-screen icons use the KINO quotation brand without changing storage or adding offline caching',async()=>{
  const html=await fs.readFile('index.html','utf8');
  assert.ok(html.includes('href="./assets/branding/manifest.webmanifest?v=2"'));
  assert.ok(html.includes('rel="apple-touch-icon"'));
  assert.ok(html.includes('content="KINO 報價"'));
  assert.equal((html.match(/src="\.\/assets\/branding\/kino-mark.svg"/g)||[]).length,2);
  const manifest=JSON.parse(await fs.readFile('assets/branding/manifest.webmanifest','utf8'));
  assert.equal(manifest.name,'奇諾影像報價系統');assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');
  assert.ok(manifest.icons.some(icon=>icon.purpose.includes('maskable')));
  for(const icon of [...manifest.icons,{src:'qt-32.png',sizes:'32x32'},{src:'qt-180.png',sizes:'180x180'}]){
    const png=await fs.readFile(path.join('assets/branding',icon.src.split('?')[0]));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16)+'x'+png.readUInt32BE(20),icon.sizes);
  }
  assert.ok(!html.includes('serviceWorker.register'));
});
