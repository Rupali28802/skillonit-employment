import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import type { Job } from '../src/lib/domain.ts';

test('fraud assessments and required indexes work on transaction-capable MongoDB', async () => {
  const env = { ...process.env }, replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = new MongoClient(replica.getUri()); Object.assign(process.env, { MONGODB_URI: replica.getUri(), MONGODB_DATABASE: 'fraud_test', DEMO_MODE: 'false' });
  const store = await import('../src/lib/store.js'); const fraud = await import('../src/lib/fraud-detection.js');
  const job: Job = { id: 'job-mongo', title: 'Engineer', company: 'Example', domain: 'example.test', country: 'India', state: '', city: 'Pune', category: 'Technology', skills: ['TypeScript'], mode: 'Remote', type: 'Full-time', salaryMin: 1, salaryMax: 2, currency: 'INR', experienceMin: 1, experienceMax: 2, description: 'Pay a registration fee and share your OTP.', requirements: '', method: 'email', email: 'attacker@other.test', status: 'review', trust: 'pending', employerId: 'employer', source: 'source', discoveredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
  try {
    await store.bootstrapIndexes();
    const assessment = await store.transaction(async r => fraud.persistJobFraudAssessment(r, job));
    assert.equal(assessment.riskLevel, 'blocked');
    assert.equal(await store.read(r => r.count('jobRiskAssessments', { riskLevel: 'blocked' })), 1);
    const db = client.db('fraud_test');
    const jobIndexes = await db.collection('jobRiskAssessments').indexes();
    assert.ok(jobIndexes.some(index => JSON.stringify(index.key) === JSON.stringify({ riskLevel: 1, assessedAt: -1 })));
    const entityIndexes = await db.collection('entityRiskAssessments').indexes();
    assert.ok(entityIndexes.some(index => index.unique === true && JSON.stringify(index.key) === JSON.stringify({ entityType: 1, entityId: 1 })));
  } finally { await store.closeStore(); await client.close(); await replica.stop(); process.env = env; }
});
