import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

test('canonical identity and source-reference indexes are production-safe', async () => {
  const env = { ...process.env }, replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = new MongoClient(replica.getUri()); Object.assign(process.env, { MONGODB_URI: replica.getUri(), MONGODB_DATABASE: 'dedupe_test', DEMO_MODE: 'false' });
  const store = await import('../src/lib/store.js');
  try {
    await store.bootstrapIndexes(); const db = client.db('dedupe_test');
    const references = await db.collection('jobSourceReferences').indexes();
    assert.ok(references.some(index => index.unique === true && JSON.stringify(index.key) === JSON.stringify({ sourceId: 1, sourceJobId: 1 })));
    const identities = await db.collection('canonicalJobIdentities').indexes();
    assert.ok(identities.some(index => index.unique === true && JSON.stringify(index.key) === JSON.stringify({ activeJobId: 1 })));
    const decisions = await db.collection('jobDeduplicationDecisions').indexes();
    assert.ok(decisions.some(index => JSON.stringify(index.key) === JSON.stringify({ kind: 1, createdAt: -1 })));
  } finally { await store.closeStore(); await client.close(); await replica.stop(); process.env = env; }
});
