import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {guardSql} from '../cloud-sync/src/sync-guard.js';

test('delete checks category revision and exact child membership at write time', () => {
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE cloud_clause_categories(workspace_id,id,updated_at); CREATE TABLE cloud_clauses(workspace_id,id,category_id,updated_at); INSERT INTO cloud_clause_categories VALUES ('w','a','1'); INSERT INTO cloud_clauses VALUES ('w','b','a','2')");
  const guard=db.prepare(guardSql('categories'));
  const run=()=>guard.get({'?1':'w','?2':'["a"]','?3':'{"a":{"updatedAt":"1","children":{"b":"2"}}}'});
  run();
  db.exec("INSERT INTO cloud_clauses VALUES ('w','c','a','2')");
  assert.throws(run,/malformed JSON/i);
  db.exec("DELETE FROM cloud_clauses WHERE id='c'; UPDATE cloud_clause_categories SET updated_at='3'");
  assert.throws(run,/malformed JSON/i);
  db.close();
});
