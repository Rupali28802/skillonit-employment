import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');

const output = process.env.POSTGRES_MANIFEST_OUTPUT?.trim()
  || '.postgres-reconciliation-manifest.jsonl';
const stream = createWriteStream(output, { flags: 'wx', encoding: 'utf8', mode: 0o600 });
const pool = new pg.Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 1,
});

await new Promise((resolve, reject) => {
  stream.once('open', resolve);
  stream.once('error', reject);
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

async function write(record) {
  if (!stream.write(`${JSON.stringify(record)}\n`)) await once(stream, 'drain');
}

const client = await pool.connect();
const startedAt = new Date().toISOString();
const counts = new Map();
let total = 0;
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '15min'");
  const countResult = await client.query('SELECT count(*)::int total, count(DISTINCT collection)::int collections FROM app_documents');
  await write({ manifestVersion: 1, startedAt, ...countResult.rows[0] });
  await client.query('DECLARE reconciliation_manifest NO SCROLL CURSOR FOR SELECT collection,id,data FROM app_documents ORDER BY collection,id');
  for (;;) {
    const result = await client.query('FETCH FORWARD 500 FROM reconciliation_manifest');
    if (!result.rowCount) break;
    for (const row of result.rows) {
      const hash = createHash('sha256').update(JSON.stringify(stable(row.data))).digest('hex');
      await write([row.collection, row.id, hash]);
      counts.set(row.collection, (counts.get(row.collection) || 0) + 1);
      total++;
    }
  }
  await client.query('CLOSE reconciliation_manifest');
  for (const [collection, count] of [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    await write({ collection, total: count, invalidIds: 0 });
  }
  await write({ completedAt: new Date().toISOString(), total, complete: true });
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
  stream.end();
  await once(stream, 'close');
}
