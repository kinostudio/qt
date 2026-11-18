import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {reserveBrowserBudget,createBudgetBrowserSession,BROWSER_BUDGET_SQL} from '../cloud-sync/src/browser-budget.js';

const migration=await fs.readFile('cloud-sync/migrations/0009_browser_budget.sql','utf8');
const start=Date.UTC(2026,10,18,12);
function fixture(t){
  const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE cloud_projects(id TEXT,data TEXT);INSERT INTO cloud_projects VALUES('keep','unchanged');");sql.exec(migration);t.after(()=>sql.close());
  const DB={prepare(query){return{bind(...values){const params=Object.fromEntries(values.map((v,i)=>['?'+(i+1),v]));return{async first(){return sql.prepare(query).get(params)||null;},async run(){return sql.prepare(query).run(params);}};},async first(){return sql.prepare(query).get()||null;}};}};
  return {sql,env:{DB,PDF_BROWSER:{}},row:()=>sql.prepare('SELECT * FROM quote_browser_budget').get()};
}

test('global quota reservation is atomic, serializes launches, and never touches existing data',async t=>{
  const f=fixture(t),results=await Promise.allSettled(Array.from({length:10},()=>reserveBrowserBudget(f.env,start)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.row().used_ms,120000);
  assert.equal(f.sql.prepare('SELECT data FROM cloud_projects').get().data,'unchanged');
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.status===429));
});

test('lazy browser is launched once and a confirmed close refunds with a safety margin',async t=>{
  const f=fixture(t);let now=start,launches=0,closes=0;
  const session=createBudgetBrowserSession(f.env,{clock:()=>now,launch:async(_,options)=>{launches++;assert.equal(options.keep_alive,10000);return{async close(){closes++;}};}});
  assert.equal(f.row(),undefined);assert.equal(await session.browser(),await session.browser());
  now+=3000;await session.close();await session.close();
  assert.equal(launches,1);assert.equal(closes,1);assert.equal(f.row().used_ms,18000);assert.equal(f.row().lease_id,null);
  await assert.rejects(reserveBrowserBudget(f.env,now),e=>e.status===429);
  assert.ok(await reserveBrowserBudget(f.env,start+25000));
});

test('unknown launch or close failures keep the entire reservation and lease',async t=>{
  for(const stage of ['launch','close']){
    const f=fixture(t),session=createBudgetBrowserSession(f.env,{clock:()=>start,launch:async()=>{if(stage==='launch')throw Error('launch failed');return{async close(){throw Error('close failed');}};}});
    if(stage==='launch')await assert.rejects(session.browser(),/launch failed/);else await session.browser();
    await session.close();assert.equal(f.row().used_ms,120000);assert.ok(f.row().lease_id);assert.equal(f.row().lease_until,start+120000);
  }
});

test('daily budget exhaustion or missing quota storage fails before browser acquisition',async t=>{
  const f=fixture(t);await reserveBrowserBudget(f.env,start);
  f.sql.prepare('UPDATE quote_browser_budget SET used_ms=480000,lease_until=0,next_start_at=0').run();
  let launches=0;const session=createBudgetBrowserSession(f.env,{clock:()=>start,launch:async()=>{launches++;}});
  await assert.rejects(session.browser(),e=>e.status===429&&/今日/.test(e.message));await session.close();assert.equal(launches,0);
  await assert.rejects(reserveBrowserBudget({},start),e=>e.status===503);
});

test('close timeout retains the full reservation instead of claiming unused time',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);
  const session=createBudgetBrowserSession(f.env,{clock:()=>start,launch:async()=>({close:()=>new Promise(()=>{})})});
  await session.browser();const closing=session.close();await new Promise(setImmediate);t.mock.timers.tick(5000);await closing;
  assert.equal(f.row().used_ms,120000);assert.ok(f.row().lease_id);
});

test('stale settlements cannot release or refund the replacement lease',async t=>{
  const f=fixture(t),old=await reserveBrowserBudget(f.env,start),next=await reserveBrowserBudget(f.env,start+120001);
  await f.env.DB.prepare(BROWSER_BUDGET_SQL.release).bind(old.day,old.id,1).run();
  assert.equal(f.row().lease_id,next.id);assert.equal(f.row().used_ms,240000);
});

test('UTC rollover cannot bypass an active lease; it resets the daily budget only after expiry',async t=>{
  const f=fixture(t),before=Date.UTC(2026,10,18,23,59,30);
  await reserveBrowserBudget(f.env,before);
  await assert.rejects(reserveBrowserBudget(f.env,before+40000),e=>e.status===429);
  await reserveBrowserBudget(f.env,before+120001);assert.equal(f.row().day,'2026-11-19');assert.equal(f.row().used_ms,120000);
});

test('watchdog closes the browser and rejects any later work',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);let closes=0,now=start;
  const session=createBudgetBrowserSession(f.env,{clock:()=>now,launch:async()=>({async close(){closes++;}})});
  await session.browser();now+=45001;t.mock.timers.tick(45001);await Promise.resolve();
  await assert.rejects(session.browser(),e=>e.status===503);await session.close();assert.equal(closes,1);assert.equal(f.row().lease_id,null);
});

test('late browser acquisition is closed after timeout and never refunds an uncertain launch',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);let resolve,closes=0;
  const session=createBudgetBrowserSession(f.env,{clock:()=>start,launch:()=>new Promise(r=>resolve=r)});
  const opening=session.browser();await new Promise(setImmediate);t.mock.timers.tick(45000);
  await assert.rejects(opening,e=>e.status===503);await session.close();resolve({async close(){closes++;}});await new Promise(setImmediate);
  assert.equal(closes,1);assert.equal(f.row().used_ms,120000);assert.ok(f.row().lease_id);
});
