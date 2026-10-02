// Read-only PostgreSQL contract and production-size check. No fixture rows are persisted.
import assert from 'node:assert/strict';
import pg from 'pg';
import { postgresReadFilter } from '../dist/lib/postgres-read-filter.js';
const db = new pg.Client({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false}});
await db.connect();
try {
  await db.query('BEGIN READ ONLY');
  await db.query("SET LOCAL statement_timeout='15s'");
  const fixture = [{id:'a',employerId:'owner',status:'published'}, {id:'b',employerId:'other',status:'published'}, {id:'c',employerId:'company',status:'draft'}, {id:'d',employerId:null}];
  for (const [query,expected] of [[{employerId:'owner'},['a']], [{employerId:{$in:['owner','company']}},['a','c']], [{employerId:{$in:[]}},[]], [{employerId:{$in:['owner','company']},status:'published'},['a']]]) {
    const filter=postgresReadFilter(query);
    const result=await db.query(`WITH app_documents AS (SELECT 'jobs' AS collection,value AS data FROM jsonb_array_elements('${JSON.stringify(fixture)}'::jsonb)) SELECT data FROM app_documents WHERE collection=$1${filter.sql}`,['jobs',...filter.values]);
    assert.deepEqual(result.rows.map(row=>row.data.id).sort(),expected);
  }
  // Select one real owner internally without printing identity or document contents.
  const owners=await db.query("SELECT id AS owner FROM app_documents WHERE collection='users' AND data->>'role'='employer' LIMIT 1");
  assert.ok(owners.rows.length,'No employer owner available for production-size read check');
  const owner=owners.rows[0].owner;
  const filter=postgresReadFilter({employerId:owner});
  const before=performance.now();
  const result=await db.query('SELECT data FROM app_documents WHERE collection=$1'+filter.sql,['jobs',...filter.values]);
  const durationMs=Math.round(performance.now()-before);
  assert.ok(result.rows.every(row=>row.data.employerId===owner));
  const expected=await db.query("SELECT count(*)::int AS total FROM app_documents WHERE collection='jobs' AND data->>'employerId'=$1",[owner]);
  assert.equal(result.rows.length,expected.rows[0].total);
  console.log(JSON.stringify({fixtureChecks:4,ownerIsolation:true,ownerRecords:result.rows.length,durationMs,readOnly:true}));
} finally { await db.query('ROLLBACK'); await db.end(); }
