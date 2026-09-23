import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationPolicySchema, applicationRequestSchema, defaultApplicationPolicy, externalApplicationUrl, profileResumeAttachment, publicApplication, type ApplicationRecord } from '../src/lib/application-engine.ts';

test('application policy validates bounded per-plan/per-method scheduling', () => {
  const policy = defaultApplicationPolicy();
  assert.equal(policy.delaysMinutes.premium.email, 0);
  assert.equal(policy.priorities.premium > policy.priorities.basic, true);
  assert.throws(() => applicationPolicySchema.parse({ delaysMinutes: { basic: { direct: -1 } } }));
  assert.throws(() => applicationRequestSchema.parse({ jobId: 'job-1', userId: 'other-user' }));
  assert.equal(applicationRequestSchema.parse({ jobId: 'job-1', confirmed: true }).confirmed, true);
  assert.throws(() => applicationRequestSchema.parse({ jobId: 'job-1', confirmed: false }));
});

test('external application destinations are HTTPS browser-safe URLs', () => {
  assert.equal(externalApplicationUrl({ method: 'external', url: 'https://jobs.lever.co/example/role/apply' }), 'https://jobs.lever.co/example/role/apply');
  assert.equal(externalApplicationUrl({ method: 'external', url: 'http://jobs.example.com/apply' }), undefined);
  assert.equal(externalApplicationUrl({ method: 'external', url: 'https://127.0.0.1/apply' }), undefined);
  assert.equal(externalApplicationUrl({ method: 'direct', url: 'https://jobs.example.com/apply' }), undefined);
});

test('confirmed profile CV content can be reused as a Gmail attachment without external storage', () => {
  const attachment = profileResumeAttachment({
    name: 'My Resume',
    content: 'Confirmed candidate resume',
    profile: { name: 'Candidate', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: true },
  });
  assert.equal(attachment.filename, 'My Resume.txt');
  assert.equal(attachment.contentType, 'text/plain');
  assert.equal(Buffer.from(attachment.base64, 'base64').toString('utf8'), 'Confirmed candidate resume');
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
