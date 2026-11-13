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

try {
  await client.connect();
  await client.query("SET lock_timeout = '2s'");
  await client.query("SET statement_timeout = '8s'");
  let cursor = '';
  let batchSize = 100;
  let retries = 0;
  let committed = 0;
  while (committed < maxBatches) {
    try {
      const result = await client.query(
        'SELECT backfill_job_keyword_vector($1, $2) AS cursor',
        [cursor, batchSize],
      );
      cursor = result.rows[0].cursor;
      if (cursor === null) {
        console.log('Backfill complete.');
        break;
      }
      committed++;
      retries = 0;
      await delay(1000);
    } catch (error) {
      if (!['57014', '55P03', '40P01'].includes(error.code) || ++retries > 4) throw error;
      batchSize = Math.max(10, Math.floor(batchSize / 2));
      await delay(retries * 2000);
    }
  }
  console.log(`Committed batches: ${committed}`);
} catch (error) {
  console.error('Backfill stopped', error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
