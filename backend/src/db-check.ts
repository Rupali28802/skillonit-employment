import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { postgresUniqueDefinitions } from './lib/postgres-store.js';

type DatabaseMode = 'postgres' | 'mongo' | 'none';

/** Select the configured store without ever echoing its connection string. */
export function databaseMode(env: NodeJS.ProcessEnv = process.env): DatabaseMode {
  if (env.DATABASE_URL?.trim()) return 'postgres';
  if (env.MONGODB_URI?.trim()) return 'mongo';
  return 'none';
}

const postgresIndexes = [
  'app_documents_collection_updated_idx',
  'app_documents_collection_status_idx',
  'app_documents_feed_variants_active_idx',
  'app_documents_jobs_public_filter_idx',
  'app_documents_jobs_public_order_idx',
  'app_documents_jobs_public_category_v1_idx',
  'app_documents_jobs_public_country_v1_idx',
  'app_documents_jobs_public_eligible_countries_v1_idx',
  'app_documents_jobs_public_mode_v1_idx',
  'app_documents_jobs_public_type_v1_idx',
  'app_documents_jobs_public_discovered_v3_idx',
];

async function checkPostgres(env: NodeJS.ProcessEnv) {
  const client = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    ssl: env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  try {
    await client.query('SELECT 1');
    const required = [...postgresIndexes, ...postgresUniqueDefinitions().map(index => index.name)];
    const result = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema() AND tablename = 'app_documents'
         AND indexname = ANY($1::text[])`,
      [required],
    );
    if (result.rows.length !== required.length) throw new Error('POSTGRES_INDEXES_MISSING');
    console.log('PASS: PostgreSQL reachable; app_documents and required indexes are present.');
  } catch {
    console.error('PostgreSQL check failed. Verify connectivity, the app_documents schema and required indexes. Sensitive driver details withheld.');
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkMongo(env: NodeJS.ProcessEnv) {
  let client: MongoClient | undefined;
  try {
    client = new MongoClient(env.MONGODB_URI!, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await client.db(env.MONGODB_DATABASE || 'skillonit').command({ ping: 1 });
    const hello = await client.db('admin').command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('TRANSACTIONS_REQUIRED');
    console.log('PASS: MongoDB reachable; replica-set or sharded topology detected. Run isolated integration tests before production rollout.');
  } catch {
    console.error('MongoDB check failed. Verify local credentials, network access and replica-set topology. Sensitive driver details withheld.');
    process.exitCode = 1;
  } finally {
    await client?.close();
  }
}

export async function runDatabaseCheck(env: NodeJS.ProcessEnv = process.env) {
  if (databaseMode(env) === 'postgres') return checkPostgres(env);
  if (databaseMode(env) === 'mongo') return checkMongo(env);
  console.error('No database is configured: set DATABASE_URL for PostgreSQL or MONGODB_URI for local legacy checks.');
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith('db-check.ts')) await runDatabaseCheck();