import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test('editor build contains current UI and only the public allowlist',async()=>{
  execFileSync(process.execPath,['scripts/build-editor.mjs']);
  assert.deepEqual((await fs.readdir('tmp/qt-editor-site')).sort(),['assets','index.html']);
  assert.equal(await fs.readFile('tmp/qt-editor-site/index.html','utf8'),await fs.readFile('index.html','utf8'));
  assert.equal(await fs.readFile('tmp/qt-editor-site/assets/pdf-form.js','utf8'),await fs.readFile('assets/pdf-form.js','utf8'));
  assert.equal(await fs.readFile('tmp/qt-editor-site/assets/local-backup.js','utf8'),await fs.readFile('assets/local-backup.js','utf8'));
  const html=await fs.readFile('tmp/qt-editor-site/index.html','utf8');
  for(const marker of ['CloudChangeContent','syncNotice','選擇印章','向上蓋住公司資訊','data-pdf-client-field','oneDriveWrites']) assert.ok(html.includes(marker),marker+' must survive migration');
});
