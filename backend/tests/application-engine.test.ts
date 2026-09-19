import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationPolicySchema, applicationRequestSchema, defaultApplicationPolicy, publicApplication, type ApplicationRecord } from '../src/lib/application-engine.ts';

test('application policy validates bounded per-plan/per-method scheduling', () => {
  const policy = defaultApplicationPolicy();
  assert.equal(policy.delaysMinutes.premium.email, 0);
  assert.equal(policy.priorities.premium > policy.priorities.basic, true);
  assert.throws(() => applicationPolicySchema.parse({ delaysMinutes: { basic: { direct: -1 } } }));
  assert.throws(() => applicationRequestSchema.parse({ jobId: 'job-1', userId: 'other-user' }));
});

test('public applications redact immutable candidate inputs and delivery details', () => {
  const row: ApplicationRecord = {
    id: 'a1', userId: 'u1', jobId: 'j1', employerId: 'e1', method: 'email', status: 'QUEUED', priority: 10,
    createdAt: new Date().toISOString(), scheduledAt: new Date().toISOString(), jobVerifiedAt: new Date().toISOString(), attempts: 0, maxAttempts: 3,
    job: { title: 'Developer', country: 'India', city: 'Pune' }, events: [],
    delivery: { destination: 'private@example.test' }, snapshot: { profile: { name: 'Private' }, rendered: { text: 'private' } },
  };
  const safe = publicApplication(row);
  assert.equal('snapshot' in safe, false);
  assert.equal('delivery' in safe, false);
  assert.equal(JSON.stringify(safe).includes('private@example.test'), false);
});
