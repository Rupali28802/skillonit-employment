import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

test('job source strategy persists atomically with production MongoDB indexes', async () => {
  const env = { ...process.env };
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = new MongoClient(replica.getUri());
  Object.assign(process.env, { MONGODB_URI: replica.getUri(), MONGODB_DATABASE: 'source_strategy_test', DEMO_MODE: 'false' });
  const store = await import('../src/lib/store.js');
  const strategy = await import('../src/lib/job-source-strategy.js');
  try {
    await store.bootstrapIndexes(); await store.bootstrapIndexes();
    const source = await strategy.createJobSource('admin-test', {
      name: 'Mongo source', provider: 'greenhouse', configuration: { board: 'mongo-fixture' }, enabled: true,
      compliance: { status: 'approved', policyEvidence: 'Approved official API integration for isolated MongoDB validation.', permittedMethod: 'official_api', jurisdictions: ['global'] },
      schedule: { intervalMinutes: 60 }, rate: { requestsPerMinute: 2 },
      retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 },
    });
    const adapter = { provider: 'greenhouse' as const, async fetch() { return {
      fetchedAt: new Date().toISOString(), records: [{ externalId: 'external-1', title: 'Engineer',
        url: 'https://jobs.example.test/external-1', description: 'Provider supplied description', location: 'Remote' }],
    }; } };
    await strategy.fetchJobSource(source.id, 'mongo-correlation', 'source-scheduler', new strategy.SourceAdapterRegistry([adapter]));
    assert.equal(await store.read(r => r.count('jobSourceVariants', { sourceId: source.id })), 1);
    const db = client.db('source_strategy_test');
    const expected: [string, Record<string, number>, boolean?][] = [
      ['jobSources', { enabled: 1, nextRunAt: 1 }],
      ['jobSources', { provider: 1, 'configuration.board': 1 }, true],
      ['jobSourceVariants', { sourceId: 1, sourceJobId: 1 }, true],
      ['jobSourceVariants', { status: 1, fetchedAt: 1 }],
      ['jobIngestionEvents', { sourceId: 1, createdAt: -1 }],
      ['jobIngestionEvents', { correlationId: 1, createdAt: 1 }],
      ['jobDiscoveryRuns', { status: 1, startedAt: -1 }],
      ['jobDiscoveryRuns', { trigger: 1, startedAt: -1 }],
    ];
    for (const [collection, key, unique] of expected) {
      const indexes = await db.collection(collection).indexes();
      assert.ok(indexes.some(index => JSON.stringify(index.key) === JSON.stringify(key) && (!unique || index.unique)), `${collection}: required source index`);
    }
    await assert.rejects(strategy.createJobSource('admin-test', {
      name: 'Duplicate board', provider: 'greenhouse', configuration: { board: 'mongo-fixture' }, enabled: false,
      compliance: { status: 'pending', policyEvidence: 'A second record must not reuse the same provider identity.', permittedMethod: 'official_api', jurisdictions: [] },
      schedule: { intervalMinutes: 60 }, rate: { requestsPerMinute: 1 },
      retry: { maxAttempts: 2, baseDelaySeconds: 30, maxDelaySeconds: 60 },
    }), { code: 11000 });
  } finally {
    await store.closeStore(); await client.close(); await replica.stop(); process.env = env;
  }
});
