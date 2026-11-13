import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const maxBatches = Number(process.argv[2] ?? 30);
if (!Number.isSafeInteger(maxBatches) || maxBatches < 1) {
  throw new Error('Supply a positive maximum batch count.');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});
let committed = 0;
try {
  await client.connect();
  await client.query("SET lock_timeout = '2s'");
  await client.query("SET statement_timeout = '10s'");
  const lock = await client.query(
    "SELECT pg_try_advisory_lock(hashtext('backfill_job_search_facts')) AS acquired",
  );
  if (!lock.rows[0].acquired) throw Object.assign(new Error(), { code: 'BACKFILL_ALREADY_RUNNING' });
  await client.query(`CREATE TABLE IF NOT EXISTS job_search_facts_backfill (
    version integer PRIMARY KEY, cursor_id text
  )`);
  const version = 1;
  const checkpoint = await client.query('SELECT cursor_id FROM job_search_facts_backfill WHERE version = $1', [version]);
  let cursor = checkpoint.rowCount ? checkpoint.rows[0].cursor_id : '';
  let batchSize = 50;
  let retries = 0;
  while (cursor !== null && committed < maxBatches) {
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT backfill_job_search_facts($1, $2) AS cursor', [cursor, batchSize]);
      const next = result.rows[0].cursor;
      await client.query(`INSERT INTO job_search_facts_backfill(version, cursor_id) VALUES ($1, $2)
        ON CONFLICT (version) DO UPDATE SET cursor_id = EXCLUDED.cursor_id`, [version, next]);
      await client.query('COMMIT');
      cursor = next;
      if (cursor !== null) committed++;
      retries = 0;
      if (cursor !== null) await delay(1000);
    } catch (error) {
      await client.query('ROLLBACK');
      if (!['57014', '55P03', '40P01'].includes(error.code) || ++retries > 4) throw error;
      batchSize = Math.max(5, Math.floor(batchSize / 2));
      await delay(retries * 2000);
    }
  }
  if (cursor === null) console.log('Backfill complete.');
} catch (error) {
  console.error('Backfill stopped', error.code ?? error.name);
  process.exitCode = 1;
} finally {
  console.log(`Committed batches: ${committed}`);
  await client.end();
}
