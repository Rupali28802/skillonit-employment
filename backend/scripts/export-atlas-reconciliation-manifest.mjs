import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error('MONGODB_URI_REQUIRED');

const output = process.env.ATLAS_MANIFEST_OUTPUT?.trim()
  || '.atlas-reconciliation-manifest.jsonl';
const database = process.env.MONGODB_DATABASE?.trim() || 'skillonit';
const startedAt = new Date().toISOString();
const stream = createWriteStream(output, { flags: 'wx', encoding: 'utf8', mode: 0o600 });
const client = new MongoClient(uri, {
  appName: 'SkillOnIT-readonly-reconciliation-manifest',
  connectTimeoutMS: 10_000,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 120_000,
  maxPoolSize: 1,
  readPreference: 'secondaryPreferred',
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

function canonical(value) {
  // This matches the existing MongoDB-to-PostgreSQL migration's JSON conversion.
  return stable(JSON.parse(JSON.stringify(value)));
}

async function write(record) {
  if (!stream.write(`${JSON.stringify(record)}\n`)) await once(stream, 'drain');
}

try {
  await client.connect();
  const db = client.db(database);
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(row => row.name)
    .sort();
  await write({ manifestVersion: 1, database, startedAt, collections: collections.length });
  let grandTotal = 0;
  for (const collection of collections) {
    let total = 0;
    let invalidIds = 0;
    const cursor = db.collection(collection).find({}, {
      projection: { _id: 0 },
      batchSize: 500,
    });
    try {
      for await (const raw of cursor) {
        if (typeof raw.id !== 'string' || !raw.id) {
          invalidIds++;
          continue;
        }
        const document = canonical(raw);
        const hash = createHash('sha256').update(JSON.stringify(document)).digest('hex');
        await write([collection, raw.id, hash]);
        total++;
      }
    } finally {
      await cursor.close();
    }
    grandTotal += total;
    await write({ collection, total, invalidIds });
    process.stderr.write(`${collection}: ${total} hashed, ${invalidIds} invalid id(s)\n`);
  }
  await write({ completedAt: new Date().toISOString(), total: grandTotal, complete: true });
} finally {
  await client.close().catch(() => {});
  stream.end();
  await once(stream, 'close');
}
