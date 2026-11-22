import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test('customer build excludes the editor, backups and credentials, and supplies privacy headers',async()=>{
  execFileSync(process.execPath,['scripts/build-signing-client.mjs']);
  const files=['_headers','_redirects','app.css','app.js','index.html','kino-logo-white.png'];
  assert.deepEqual((await fs.readdir('tmp/qt-signing-site')).sort(),files);
  for(const file of files)assert.deepEqual(await fs.readFile('tmp/qt-signing-site/'+file),await fs.readFile('signing-client/'+file));
  const headers=await fs.readFile('tmp/qt-signing-site/_headers','utf8');
  for(const marker of ['Cache-Control: no-store','Referrer-Policy: no-referrer','noindex, nofollow',"frame-ancestors 'none'"])assert.ok(headers.includes(marker));
  assert.equal((await fs.readFile('tmp/qt-signing-site/_redirects','utf8')).trim(),'/s/* /index.html 200');
});
