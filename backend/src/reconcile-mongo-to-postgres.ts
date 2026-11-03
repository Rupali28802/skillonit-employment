import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { Pool } from 'pg';

type DocumentRow = Record<string, unknown> & { id?: unknown };

const batchSize = 250;
const insertDocuments = `
  INSERT INTO app_documents(collection,id,data,updated_at)
  SELECT $1,x->>'id',x,now()
  FROM jsonb_array_elements($2::jsonb) x
  -- Preserve every existing unique-key owner (for example a user with the
  -- same email but a different legacy id). The reconciliation never replaces
  -- a target document merely to satisfy a source-only primary key.
  ON CONFLICT DO NOTHING
  RETURNING id
`;
const insertConflicts = `
  INSERT INTO app_documents(collection,id,data,updated_at)
  SELECT 'migrationConflicts',x->>'id',x,now()
  FROM jsonb_array_elements($1::jsonb) x
  ON CONFLICT(collection,id) DO UPDATE
  SET data=excluded.data,updated_at=excluded.updated_at
`;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]),
  );
  return value;
}

function normalize(value: DocumentRow): DocumentRow {
  return stable(JSON.parse(JSON.stringify(value))) as DocumentRow;
}

function digest(value: DocumentRow) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function reconcileCollection(mongo: MongoClient, pg: Pool, database: string, collection: string) {
  let imported = 0;
  let identical = 0;
  let conflicts = 0;
  let invalidIds = 0;
  const cursor = mongo.db(database).collection(collection).find({}, { projection: { _id: 0 }, batchSize });
  try {
    for (;;) {
      const sourceRows: DocumentRow[] = [];
      while (sourceRows.length < batchSize && await cursor.hasNext()) {
        const document = normalize(await cursor.next() as DocumentRow);
        if (typeof document.id !== 'string' || !document.id) { invalidIds++; continue; }
        sourceRows.push(document);
      }
      if (!sourceRows.length) break;
      const ids = sourceRows.map(row => row.id as string);
      const existing = await pg.query<{ id: string; data: DocumentRow }>(
        'SELECT id,data FROM app_documents WHERE collection=$1 AND id=ANY($2::text[])', [collection, ids],
      );
      const targetById = new Map(existing.rows.map(row => [row.id, normalize(row.data)]));
      const missing: DocumentRow[] = [];
      const audit: DocumentRow[] = [];
      for (const source of sourceRows) {
        const id = source.id as string;
        const target = targetById.get(id);
        if (!target) { missing.push(source); continue; }
        if (digest(source) === digest(target)) { identical++; continue; }
        conflicts++;
        // The source remains intact in MongoDB. Store a hash-only audit marker
        // rather than copying sensitive profile/application content to a second
        // PostgreSQL document. Application reads continue using PostgreSQL.
        audit.push({
          id: `mongo-postgres:${collection}:${id}`,
          collection,
          sourceId: id,
          sourceHash: digest(source),
          targetHash: digest(target),
          policy: 'preserve-postgres',
          observedAt: new Date().toISOString(),
        });
      }
      if (missing.length) {
        const inserted = await pg.query<{ id: string }>(insertDocuments, [collection, JSON.stringify(missing)]);
        const insertedIds = new Set(inserted.rows.map(row => row.id));
        imported += insertedIds.size;
        for (const source of missing) if (!insertedIds.has(source.id as string)) {
          conflicts++;
          audit.push({
            id: `mongo-postgres:${collection}:${source.id}`,
            collection,
            sourceId: source.id,
            sourceHash: digest(source),
            targetHash: null,
            policy: 'preserve-postgres-unique-key-owner',
            observedAt: new Date().toISOString(),
          });
        }
      }
      if (audit.length) await pg.query(insertConflicts, [JSON.stringify(audit)]);
    }
  } finally {
    await cursor.close();
  }
  return { collection, imported, identical, conflicts, invalidIds };
}

async function reconcile() {
  if (process.env.RECONCILIATION_CONFIRM !== 'IMPORT_MONGO_ONLY_PRESERVE_POSTGRES') throw new Error('RECONCILIATION_CONFIRM_REQUIRED');
  if (!process.env.MONGODB_URI || !process.env.DATABASE_URL) throw new Error('MONGODB_URI_AND_DATABASE_URL_REQUIRED');
  const mongo = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 10_000 });
  const pg = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 2 });
  try {
    await mongo.connect();
    const database = process.env.MONGODB_DATABASE || 'skillonit';
    const collections = (await mongo.db(database).listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
    const reports = [];
    for (const collection of collections) {
      const report = await reconcileCollection(mongo, pg, database, collection);
      reports.push(report);
      console.log(JSON.stringify(report));
    }
    const total = reports.reduce((result, report) => ({
      imported: result.imported + report.imported,
      identical: result.identical + report.identical,
      conflicts: result.conflicts + report.conflicts,
      invalidIds: result.invalidIds + report.invalidIds,
    }), { imported: 0, identical: 0, conflicts: 0, invalidIds: 0 });
    console.log(JSON.stringify({ status: 'RECONCILIATION_COMPLETE', collections: reports.length, ...total }));
  } finally {
    await mongo.close();
    await pg.end();
  }
}

if (process.argv[1]?.endsWith('reconcile-mongo-to-postgres.ts')) await reconcile();
