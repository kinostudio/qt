import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import worker from '../cloud-sync/src/index.js';
import {PRINT_FONT_URL,createPrintDocument} from '../cloud-sync/src/pdf-render.js';

test('new editor origin is allowed without removing legacy origin or changing storage identities',async()=>{
  const config=JSON.parse(await fs.readFile('cloud-sync/wrangler.jsonc','utf8'));
  for(const origin of ['https://qt.kinostudio.tw','https://aaronkino.github.io']) {
    const response=await worker.fetch(new Request('https://api.test/api/sync',{method:'OPTIONS',headers:{origin}}),config.vars);
    assert.equal(response.status,204);
    assert.equal(response.headers.get('access-control-allow-origin'),origin);
  }
  const rejected=await worker.fetch(new Request('https://api.test/api/sync',{method:'OPTIONS',headers:{origin:'https://quote.kinostudio.tw'}}),config.vars);
  assert.equal(rejected.status,403);
  assert.equal(config.d1_databases[0].database_id,'ed133050-7bc3-422a-95bb-4163b8305a4a');
  assert.equal(config.r2_buckets[0].bucket_name,'kino-quotation-stamps');
  assert.equal(PRINT_FONT_URL,'https://qt.kinostudio.tw/assets/pdf/NotoSansTC-Regular.ttf');
  assert.ok(createPrintDocument({html:'',css:''}).includes('font-src data: https://qt.kinostudio.tw'));
});
