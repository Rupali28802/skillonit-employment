import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

test('lifecycle events and expiry query indexes are production-safe', async () => {
  const env = { ...process.env }, replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = new MongoClient(replica.getUri()); Object.assign(process.env, { MONGODB_URI: replica.getUri(), MONGODB_DATABASE: 'lifecycle_test', DEMO_MODE: 'false' });
  const store = await import('../src/lib/store.js');
  try {
    await store.bootstrapIndexes(); const db = client.db('lifecycle_test');
    const events = await db.collection('jobLifecycleEvents').indexes();
    assert.ok(events.some(index => index.unique === true && JSON.stringify(index.key) === JSON.stringify({ jobId: 1, revision: 1 })));
    const jobs = await db.collection('jobs').indexes();
    assert.ok(jobs.some(index => JSON.stringify(index.key) === JSON.stringify({ 'lifecycle.state': 1, expiresAt: 1, id: 1 })));
  } finally { await store.closeStore(); await client.close(); await replica.stop(); process.env = env; }
});
