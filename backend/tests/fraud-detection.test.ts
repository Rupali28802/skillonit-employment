import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Job } from '../src/lib/domain.ts';
import { assessDestination, assessEmployer, assessJob, assessSource, defaultFraudPolicy, fraudPolicySchema, persistJobFraudAssessment, recheckFraud } from '../src/lib/fraud-detection.ts';
import { read, transaction } from '../src/lib/store.ts';

async function sandbox(run: () => Promise<void>) {
  const cwd = process.cwd(), env = { ...process.env }, directory = await mkdtemp(path.join(tmpdir(), 'skillonit-fraud-'));
  process.chdir(directory); process.env.DEMO_MODE = 'true'; delete process.env.MONGODB_URI;
  try { await run(); } finally { process.chdir(cwd); process.env = env; await rm(directory, { recursive: true, force: true }); }
}

const job = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-one', title: 'Software Engineer', company: 'Example', domain: 'example.test', country: 'India', state: 'Maharashtra', city: 'Pune', category: 'Technology', skills: ['TypeScript'], mode: 'Hybrid', type: 'Full-time', salaryMin: 100, salaryMax: 200, currency: 'INR', experienceMin: 2, experienceMax: 5, description: 'Build secure software.', requirements: 'TypeScript experience.', method: 'email', email: 'careers@example.test', status: 'review', trust: 'pending', employerId: 'employer-one', source: 'source-one', discoveredAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z', ...overrides,
});

async function seedTrustedContext() {
  await transaction(async r => {
    await r.put('employers', { id: 'employer-one', domain: 'example.test', website: 'https://example.test', status: 'verified' });
    await r.put('jobSources', { id: 'source-one', enabled: true, compliance: { status: 'approved' }, health: { status: 'healthy', consecutiveFailures: 0 } });
  });
}

test('trusted job, employer, source and corporate destination assess as low risk', async () => sandbox(async () => {
  await seedTrustedContext();
  await read(async r => {
    assert.equal((await assessEmployer(r, await r.get('employers', 'employer-one'))).riskLevel, 'low');
    assert.equal((await assessSource(r, await r.get('jobSources', 'source-one'))).riskLevel, 'low');
    assert.equal((await assessDestination(r, job())).riskLevel, 'low');
    assert.equal((await assessJob(r, job())).riskLevel, 'low');
  });
}));

test('payment and credential harvesting job is blocked with redacted reason codes', async () => sandbox(async () => {
  await seedTrustedContext();
  const unsafe = job({ description: 'Pay a registration fee and send your OTP and password to proceed.' });
  const assessment = await transaction(r => persistJobFraudAssessment(r, unsafe));
  assert.equal(assessment.riskLevel, 'blocked');
  assert.ok(assessment.reasonCodes.includes('JOB_PAYMENT_REQUEST'));
  assert.ok(assessment.reasonCodes.includes('JOB_CREDENTIAL_HARVESTING'));
  assert.equal(JSON.stringify(assessment).includes('password'), false);
  assert.equal((await read(r => r.get<any>('jobRiskAssessments', unsafe.id)))?.state, 'blocked');
}));

test('application destinations detect domain mismatch, insecure URLs and malicious redirects', async () => sandbox(async () => {
  await seedTrustedContext();
  await read(async r => {
    const email = await assessDestination(r, job({ email: 'jobs@gmail.com' }));
    assert.equal(email.riskLevel, 'blocked');
    assert.ok(email.reasonCodes.includes('DESTINATION_DOMAIN_MISMATCH'));
    const url = await assessDestination(r, job({ method: 'external', email: undefined, url: 'http://127.0.0.1/apply?redirect=https://evil.test' }));
    assert.equal(url.riskLevel, 'blocked');
    assert.ok(url.reasonCodes.includes('DESTINATION_NOT_HTTPS'));
    assert.ok(url.reasonCodes.includes('DESTINATION_IP_HOST'));
  });
}));

test('reports and rejected employers escalate risk and batch recheck quarantines published jobs', async () => sandbox(async () => {
  await seedTrustedContext();
  await transaction(async r => {
    await r.put('employers', { id: 'employer-one', domain: 'example.test', status: 'rejected' });
    await r.put('fraudReports', { id: 'report-one', entityType: 'job', entityId: 'job-one', userId: 'user-one', reason: 'The recruiter requested money from me.', status: 'pending', createdAt: new Date().toISOString() });
    await r.put('jobs', job({ status: 'published', trust: 'verified' }));
  });
  const run = await recheckFraud('admin', { jobId: 'job-one' });
  assert.equal(run.flagged, 1);
  const stored = await read(r => r.get<Job>('jobs', 'job-one'));
  assert.equal(stored?.trust, 'flagged');
  assert.equal(stored?.status, 'review');
  assert.equal(await read(r => r.count('auditLogs', { action: 'fraud.rechecked' })), 1);
}));

test('fraud policy validates ordered thresholds and bounded configurable infrastructure lists', () => {
  assert.equal(defaultFraudPolicy().rulesVersion, 'fraud-v1');
  assert.throws(() => fraudPolicySchema.parse({ reviewThreshold: 60, highThreshold: 50, blockedThreshold: 80 }));
  assert.throws(() => fraudPolicySchema.parse({ freeEmailDomains: Array.from({ length: 101 }, (_, index) => `mail${index}.test`) }));
});
