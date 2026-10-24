import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresReadFilter } from '../src/lib/postgres-read-filter.js';

test('employer owner and association filters are parameterized before fetching documents', () => {
  const filter = postgresReadFilter({ employerId: { $in: ['owner', 'company'] }, status: 'published' });
  assert.equal(filter.sql, " AND ((data #> $2::text[]) = $3::jsonb OR (data #> $2::text[]) = $4::jsonb) AND ((data #> ARRAY['status']) = $5::jsonb)");
  assert.deepEqual(filter.values, [['employerId'], '"owner"', '"company"', '"published"']);
  assert.equal(filter.complete, true);
});
test('unsupported predicates are retained for the existing matcher; empty membership cannot broaden access', () => {
  assert.equal(postgresReadFilter({ employerId: { $in: [] } }).sql, ' AND FALSE');
  const mixed = postgresReadFilter({ $or: [{id:'a'}], title: /engineer/i, expiresAt: {$gt:'now'}, missing: undefined, nullable: null });
  assert.equal(mixed.sql, " AND ((data #> ARRAY['expiresAt']) > $2::jsonb)");
  assert.deepEqual(mixed.values, ['"now"']);
  assert.equal(mixed.complete, false);
  assert.deepEqual(postgresReadFilter({ 'profile.confirmed': true, count: 0 }).values, [['profile','confirmed'],'true',['count'],'0']);
});

test('field names and hostile values never become executable SQL', () => {
  const value = "owner'); DROP TABLE app_documents; --";
  const filter = postgresReadFilter({ [value]: value });
  assert.ok(!filter.sql.includes(value));
  assert.deepEqual(filter.values, [[value],JSON.stringify(value)]);
});
test('exclusion membership remains parameterized and preserves missing-field semantics', () => {
  const filter = postgresReadFilter({ status: { $nin: ['QUEUED', 'FAILED'] } });
  assert.equal(filter.sql, " AND ((data #> ARRAY['status']) IS NULL OR ((data #> ARRAY['status']) <> $2::jsonb AND (data #> ARRAY['status']) <> $3::jsonb))");
  assert.deepEqual(filter.values, ['"QUEUED"', '"FAILED"']);
  assert.deepEqual(postgresReadFilter({ status: { $nin: [] } }), { sql: '', values: [], complete: true });
});
test('primary document ids use the indexed id column for batch membership', () => {
  const include = postgresReadFilter({ id: { $in: ['job-1', 'job-2'] } });
  assert.equal(include.sql, ' AND id = ANY($2::text[])');
  assert.deepEqual(include.values, [['job-1', 'job-2']]);
  const exclude = postgresReadFilter({ id: { $nin: ['job-1'] } });
  assert.equal(exclude.sql, ' AND id <> ALL($2::text[])');
  assert.deepEqual(exclude.values, [['job-1']]);
});
test('range and inequality predicates are safely pushed down for bounded job reads', () => {
  const filter = postgresReadFilter({ status:'published', sample:{$ne:true}, expiresAt:{$gt:'2026-10-02T00:00:00.000Z'} });
  assert.equal(filter.complete, true);
  assert.match(filter.sql, /IS NULL OR/);
  assert.match(filter.sql, /> \$4::jsonb/);
  assert.deepEqual(filter.values, ['"published"','true','"2026-10-02T00:00:00.000Z"']);
});
