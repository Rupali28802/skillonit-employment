import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

test('ingestion persistence and indexes work on transaction-capable MongoDB', async () => {
  const env = { ...process.env }, replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = new MongoClient(replica.getUri()); Object.assign(process.env, { MONGODB_URI: replica.getUri(), MONGODB_DATABASE: 'ingestion_test', DEMO_MODE: 'false' });
  const store = await import('../src/lib/store.js'); const ingestion = await import('../src/lib/job-ingestion.js');
  try {
    await store.bootstrapIndexes();
    await store.transaction(async r => {
      await r.put('jobSources', { id: 'source', name: 'Mongo Provider', enabled: true, compliance: { status: 'approved', permittedMethod: 'official_api' } });
      await r.put('jobSourceVariants', { id: 'variant', sourceId: 'source', sourceJobId: 'external', fetchedAt: '2026-01-01T00:00:00.000Z', status: 'needs_normalization', provenance: { provider: 'greenhouse', sourceUrl: 'https://jobs.example.test/external', permittedMethod: 'official_api' }, normalized: { id: 'external', title: 'Engineer', url: 'https://jobs.example.test/external', description: 'A legitimate software engineering role.', city: 'Pune' } });
    });
    const result = await ingestion.runIngestion('mongo-test', { async index() { return 'not_eligible'; } }, new Date('2026-01-02T00:00:00.000Z'));
    assert.equal(result.status, 'COMPLETED'); assert.equal(await store.read(r => r.count('jobs', { source: 'source' })), 1);
    const db = client.db('ingestion_test');
    for (const [collection, key] of [['jobIngestionRuns', { status: 1, startedAt: -1 }], ['jobSourceVariants', { status: 1, retryAt: 1, leaseUntil: 1 }], ['jobFingerprints', { jobId: 1 }]] as const) {
      const indexes = await db.collection(collection).indexes(); assert.ok(indexes.some(index => JSON.stringify(index.key) === JSON.stringify(key)), `${collection} ingestion index`);
    }
  } finally { await store.closeStore(); await client.close(); await replica.stop(); process.env = env; }
});
