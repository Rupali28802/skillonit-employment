import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { bootstrapIndexes, closeStore, read, transaction } from '../src/lib/store.js';
import { configureRankingPolicy, getMatches, getRankingPolicy } from '../src/lib/matching-engine.js';
import { syncMatchingIndex } from '../src/lib/matching-indexer.js';
import { defaultRankingPolicy } from '../src/lib/matching-contracts.js';
import { sampleJobs } from '../src/lib/fixtures.js';
import type { User } from '../src/lib/domain.js';

test('matching MongoDB persistence, unique indexes, transactional policy revision and authoritative confirmation', async () => {
  const env = { ...process.env }, replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = new MongoClient(replica.getUri());
  try {
    Object.assign(process.env, { MONGODB_URI: replica.getUri(), MONGODB_DATABASE: 'architecture_test', DEMO_MODE: 'true', MATCHING_SEARCH_PROVIDER: 'local', MATCHING_SEMANTIC: 'off' });
    await bootstrapIndexes(); await bootstrapIndexes();
    const job = sampleJobs()[0];
    const student = { id: 'matching-student', email: 'matching-student@example.invalid', role: 'student', verified: true,
      profile: { name: '', headline: job.title, skills: job.skills, experience: job.experienceMin, education: '', country: '', city: '', confirmed: true },
      preferences: { roles: [job.title], relatedRoles: [], countries: [], modes: [job.mode], exclusions: [], automation: false, dailyCap: 5 } } as User;
    const admin = { ...student, id: 'matching-admin', email: 'matching-admin@example.invalid', role: 'admin' as const };
    await transaction(async r => { await r.put('users', student); await r.put('users', admin); await r.put('jobs', job); });
    const results = await Promise.allSettled([1, 2].map(() => configureRankingPolicy(admin, { expectedRevision: 0, policy: defaultRankingPolicy() })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await read(getRankingPolicy)).revision, 1);
    await assert.rejects(configureRankingPolicy(student, {}), { code: 'FORBIDDEN' });
    assert.equal((await getMatches(student.id)).items[0].job.id, job.id);
    await transaction(r => r.put('users', { ...student, profile: { ...student.profile, confirmed: false } }));
    assert.deepEqual((await getMatches(student.id)).items, []);
    const search = { async retrieve() { return []; }, async index() {}, async remove() {} };
    await read(r => syncMatchingIndex(r, search, undefined, defaultRankingPolicy(), { version: 'integration-v1' }));
    await closeStore(); // Prove persisted state survives connection recycling.
    assert.equal((await read(r => r.get<{version: string}>('matchingIndexState', job.id)))?.version, 'integration-v1');
    const db = client.db('architecture_test');
    assert.ok((await db.collection('matchingIndexState').indexes()).some(i => i.unique && i.key.id === 1));
    assert.ok((await db.collection('jobs').indexes()).some(i => i.key.status === 1 && i.key.trust === 1 && i.key.id === 1));
    await assert.rejects(db.collection('matchingIndexState').insertOne({ id: job.id }), { code: 11000 });
    const audits = await db.collection('auditLogs').find({ actorId: admin.id }).toArray();
    assert.equal(audits.length, 1); assert.ok(!JSON.stringify(audits).includes(student.email));
  } finally { await closeStore(); await client.close(); await replica.stop(); process.env = env; }
});
