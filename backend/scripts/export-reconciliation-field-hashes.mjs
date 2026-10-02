import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { MongoClient } from 'mongodb';
import pg from 'pg';

const [comparisonPath, outputPath] = process.argv.slice(2);
const source = process.env.RECONCILIATION_SOURCE;
if (!comparisonPath || !outputPath || !['atlas', 'postgres'].includes(source)) {
  throw new Error('COMPARISON_OUTPUT_AND_SOURCE_REQUIRED');
}
const comparison = JSON.parse(await readFile(comparisonPath, 'utf8'));
const requests = comparison.collections
  .map(row => [row.collection, row.ids?.different || []])
  .filter(([, ids]) => ids.length);
const output = createWriteStream(outputPath, { flags: 'wx', encoding: 'utf8', mode: 0o600 });
await new Promise((resolve, reject) => {
  output.once('open', resolve);
  output.once('error', reject);
});
const stable = value => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const digest = value => createHash('sha256').update(JSON.stringify(stable(JSON.parse(JSON.stringify(value))))).digest('hex');
const fieldHashes = document => Object.fromEntries(Object.keys(document).sort().map(key => [key, digest(document[key])]));
const write = async row => { if (!output.write(`${JSON.stringify(row)}\n`)) await once(output, 'drain'); };
const chunk = (values, size = 500) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

let total = 0;
try {
  await write({ source, startedAt: new Date().toISOString(), requested: requests.reduce((sum, [, ids]) => sum + ids.length, 0) });
  if (source === 'atlas') {
    if (!process.env.MONGODB_URI?.trim()) throw new Error('MONGODB_URI_REQUIRED');
    const client = new MongoClient(process.env.MONGODB_URI, { appName: 'SkillOnIT-readonly-field-reconciliation', maxPoolSize: 1, serverSelectionTimeoutMS: 10_000 });
    try {
      await client.connect();
      const db = client.db(process.env.MONGODB_DATABASE || 'skillonit');
      for (const [collection, ids] of requests) for (const batch of chunk(ids)) {
        for await (const row of db.collection(collection).find({ id: { $in: batch } }, { projection: { _id: 0 }, batchSize: 500 })) {
          await write([collection, row.id, fieldHashes(row)]); total++;
        }
      }
    } finally { await client.close(); }
  } else {
    if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL_REQUIRED');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 1 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='10min'");
      for (const [collection, ids] of requests) for (const batch of chunk(ids)) {
        const result = await client.query('SELECT id,data FROM app_documents WHERE collection=$1 AND id=ANY($2::text[])', [collection, batch]);
        for (const row of result.rows) { await write([collection, row.id, fieldHashes(row.data)]); total++; }
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); await pool.end(); }
  }
  await write({ source, completedAt: new Date().toISOString(), total, complete: true });
} finally {
  output.end();
  await once(output, 'close');
}
