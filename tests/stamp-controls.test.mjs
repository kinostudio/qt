import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('stamp opacity keeps the full 0–100 range through JSON reload',async()=>{
  const html=await fs.readFile('index.html','utf8');
  const source=html.slice(html.indexOf('const STAMP_SCHEMA_VERSION ='),html.indexOf('const normalizeStampAsset ='));
  const normalize=vm.runInNewContext(source+';normalizeStampInstance');
  for(const opacity of [0,1,45,90,100]) {
    const stamp=normalize({opacity,xMm:12,yMm:-18});
    assert.equal(normalize(JSON.parse(JSON.stringify(stamp))).opacity,opacity);
    assert.equal(stamp.xMm,12);
    assert.equal(stamp.yMm,-18);
  }
  assert.equal(normalize({opacity:-1}).opacity,0);
  assert.equal(normalize({opacity:101}).opacity,100);
  assert.equal(normalize({}).opacity,96);
});
