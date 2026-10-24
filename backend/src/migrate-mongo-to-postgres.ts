import { MongoClient } from 'mongodb';
import { Pool } from 'pg';

type MigrationDocument = Record<string, unknown> & { id?: unknown };

const upsertBatchSql = `
  INSERT INTO app_documents(collection,id,data,updated_at)
  SELECT $1,x->>'id',x,now()
  FROM jsonb_array_elements($2::jsonb) x
  ON CONFLICT(collection,id) DO UPDATE
  SET data=excluded.data,updated_at=excluded.updated_at
`;

function configuredCollections(value: string | undefined) {
  const collections = value?.split(',').map(name => name.trim()).filter(Boolean) ?? [];
  return new Set(collections);
}

async function migrate() {
  const source = process.env.MONGODB_URI;
  const target = process.env.DATABASE_URL;
  if (!source || !target) throw new Error('MONGODB_URI and DATABASE_URL are required for migration');
  if (process.env.MIGRATION_CONFIRM !== 'COPY_MONGO_TO_POSTGRES') throw new Error('MIGRATION_CONFIRM_REQUIRED');

  const mongo = new MongoClient(source);
  const pg = new Pool({
    connectionString: target,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  const include = configuredCollections(process.env.MIGRATION_COLLECTIONS);

  try {
    await mongo.connect();
    await pg.query(`CREATE TABLE IF NOT EXISTS app_documents(
      collection text NOT NULL,
      id text NOT NULL,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(collection,id)
    )`);

    const db = mongo.db(process.env.MONGODB_DATABASE || 'skillonit');
    const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map(({ name }) => name)
      .filter(name => !include.size || include.has(name))
      .sort();

    for (const name of collections) {
      let scanned = 0;
      let upserted = 0;
      let invalidIds = 0;
      let batch: MigrationDocument[] = [];
      const flush = async () => {
        if (!batch.length) return;
        await pg.query(upsertBatchSql, [name, JSON.stringify(batch)]);
        upserted += batch.length;
        batch = [];
      };
      const cursor = db.collection(name).find({}, { projection: { _id: 0 }, batchSize: 250 });
      try {
        for await (const raw of cursor) {
          scanned++;
          const document = raw as MigrationDocument;
          if (typeof document.id !== 'string' || !document.id) {
            invalidIds++;
            continue;
          }
          batch.push(document);
          if (batch.length === 250) await flush();
        }
        await flush();
      } finally {
        await cursor.close();
      }
      console.log(JSON.stringify({ collection: name, scanned, upserted, invalidIds }));
    }
  } finally {
    await mongo.close();
    await pg.end();
  }
}

await migrate();
