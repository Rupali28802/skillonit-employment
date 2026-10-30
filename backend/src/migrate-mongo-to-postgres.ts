import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { bootstrapPostgres } from './lib/postgres-store.js';

type MigrationDocument = Record<string, unknown> & { id?: unknown };
type CollectionReport = { collection: string; source: number; copied: number; target: number; digest: string };

const upsertBatchSql = `
  INSERT INTO app_documents(collection,id,data,updated_at)
  SELECT $1,x->>'id',x,now()
  FROM jsonb_array_elements($2::jsonb) x
  ON CONFLICT(collection,id) DO UPDATE
  SET data=excluded.data,updated_at=excluded.updated_at
`;

function configuredCollections(value: string | undefined) {
  return new Set(value?.split(',').map(name => name.trim()).filter(Boolean) ?? []);
}

// JSONB does not preserve object-key insertion order. Hash a canonical form so
// verification proves every migrated value, not merely collection counts.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

function jsonDocument(raw: MigrationDocument): MigrationDocument {
  // Apply the same JSON conversion that is sent to JSONB, including BSON dates.
  return JSON.parse(JSON.stringify(raw)) as MigrationDocument;
}

function addDigest(hash: ReturnType<typeof createHash>, row: MigrationDocument) {
  hash.update(String(row.id));
  hash.update('\0');
  hash.update(canonicalJson(row));
  hash.update('\n');
}

async function ensureTargetIsSafe(pg: Pool, names: string[]) {
  await pg.query(`CREATE TABLE IF NOT EXISTS app_documents(
    collection text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(collection,id)
  )`);
  if (process.env.MIGRATION_ALLOW_TARGET_DATA === 'true' || !names.length) return;
  const result = await pg.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM app_documents WHERE collection = ANY($1::text[])', [names],
  );
  if (Number(result.rows[0]?.count || 0) > 0) throw new Error('TARGET_DATABASE_NOT_EMPTY: set MIGRATION_ALLOW_TARGET_DATA=true only for a reviewed rerun');
}

async function copyAndVerifyCollection(mongo: MongoClient, pg: Pool, database: string, name: string): Promise<CollectionReport> {
  let source = 0;
  let copied = 0;
  let previousId = '';
  let batch: MigrationDocument[] = [];
  const sourceDigest = createHash('sha256');
  const flush = async () => {
    if (!batch.length) return;
    await pg.query(upsertBatchSql, [name, JSON.stringify(batch)]);
    copied += batch.length;
    batch = [];
  };
  const cursor = mongo.db(database).collection(name).find({}, { projection: { _id: 0 }, batchSize: 250 }).sort({ id: 1 });
  try {
    for await (const raw of cursor) {
      source++;
      const document = jsonDocument(raw as MigrationDocument);
      if (typeof document.id !== 'string' || !document.id) throw new Error(`INVALID_DOCUMENT_ID:${name}`);
      if (document.id === previousId) throw new Error(`DUPLICATE_DOCUMENT_ID:${name}`);
      previousId = document.id;
      addDigest(sourceDigest, document);
      batch.push(document);
      if (batch.length === 250) await flush();
    }
    await flush();
  } finally {
    await cursor.close();
  }

  const targetDigest = createHash('sha256');
  const targetRows = await pg.query<{ data: MigrationDocument }>('SELECT data FROM app_documents WHERE collection=$1 ORDER BY id ASC', [name]);
  for (const row of targetRows.rows) addDigest(targetDigest, row.data);
  const digest = sourceDigest.digest('hex');
  const target = targetRows.rows.length;
  if (source !== copied || source !== target || digest !== targetDigest.digest('hex')) throw new Error(`INTEGRITY_CHECK_FAILED:${name}`);
  return { collection: name, source, copied, target, digest };
}

export async function migrate() {
  const source = process.env.MONGODB_URI;
  const target = process.env.DATABASE_URL;
  if (!source || !target) throw new Error('MONGODB_URI and DATABASE_URL are required for migration');
  if (process.env.MIGRATION_CONFIRM !== 'COPY_MONGO_TO_POSTGRES') throw new Error('MIGRATION_CONFIRM_REQUIRED');

  const mongo = new MongoClient(source);
  const pg = new Pool({ connectionString: target, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } });
  try {
    await mongo.connect();
    const database = process.env.MONGODB_DATABASE || 'skillonit';
    const include = configuredCollections(process.env.MIGRATION_COLLECTIONS);
    const collections = (await mongo.db(database).listCollections({}, { nameOnly: true }).toArray())
      .map(({ name }) => name).filter(name => !include.size || include.has(name)).sort();
    await ensureTargetIsSafe(pg, collections);
    const reports: CollectionReport[] = [];
    for (const name of collections) {
      const report = await copyAndVerifyCollection(mongo, pg, database, name);
      reports.push(report);
      console.log(JSON.stringify(report));
    }
    // Build constraints only after the copied rows pass canonical JSON verification.
    await bootstrapPostgres();
    console.log(JSON.stringify({ status: 'MIGRATION_COMPLETE', collections: reports.length, documents: reports.reduce((sum, row) => sum + row.source, 0) }));
  } finally {
    await mongo.close();
    await pg.end();
  }
}

if (process.argv[1]?.endsWith('migrate-mongo-to-postgres.ts')) await migrate();
