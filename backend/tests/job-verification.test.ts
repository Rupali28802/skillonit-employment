import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Job } from '../src/lib/domain.ts';
import { evaluateJobVerification, verifyJobs } from '../src/lib/job-verification.ts';
import { read, transaction } from '../src/lib/store.ts';

async function sandbox(run: () => Promise<void>) {
  const cwd = process.cwd(), env = { ...process.env }, directory = await mkdtemp(path.join(tmpdir(), 'skillonit-verification-'));
  process.chdir(directory); process.env.DEMO_MODE = 'true'; delete process.env.MONGODB_URI; delete process.env.DATABASE_URL;
  try { await run(); } finally { process.chdir(cwd); process.env = env; await rm(directory, { recursive: true, force: true }); }
}
const now = new Date('2026-10-02T10:00:00.000Z');
const job = (overrides: Partial<Job> = {}): Job => ({
  id: 'feed-job-1', title: 'Software Engineer', company: 'Example', domain: '', country: 'India', state: '', city: 'Remote', category: 'Technology', skills: ['TypeScript'], mode: 'Remote', type: 'Full-time', salaryMin: 0, salaryMax: 0, currency: '', experienceMin: 0, experienceMax: 0, description: 'Build and maintain secure production software systems.', requirements: 'See the original listing for the complete requirements.', method: 'external', url: 'https://jobs.example.test/1', status: 'published', trust: 'pending', employerId: '', source: 'Example feed', discoveredAt: '2026-10-01T00:00:00.000Z', sourcePostedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z', feed: { sourceId: 'feed-source', externalId: '1', publicListing: true, attributionUrl: 'https://jobs.example.test/1', lastSeenAt: '2026-10-02T09:00:00.000Z' }, ...overrides,
});
async function seedTrustedFeed(value = job()) {
  await transaction(async r => {
    await r.put('jobs', value);
    await r.put('jobFeedSources', { id: 'feed-source', type: 'ashby', enabled: true, approved: true, publicListing: true, publish: true, intervalMinutes: 30 });
    await r.put('jobFeedStates', { id: 'feed-source', status: 'completed', failures: 0, lastSuccessAt: '2026-10-02T09:30:00.000Z' });
    await r.put('jobFeedVariants', { id: 'variant-1', jobId: value.id, sourceId: 'feed-source', active: true });
  });
}

test('approved healthy public feed job is eligible and dry-run makes no writes', async () => sandbox(async () => {
  await seedTrustedFeed();
  const result = await verifyJobs('queue-test', { jobId: 'feed-job-1', dryRun: true }, now);
  assert.equal(result.verified, 1);
  assert.equal((await read(r => r.get<Job>('jobs', 'feed-job-1')))?.trust, 'pending');
  assert.equal(await read(r => r.count('auditLogs', {})), 0);
}));

test('verification persists evidence, fraud assessment and one idempotent audit', async () => sandbox(async () => {
  await seedTrustedFeed();
  assert.equal((await verifyJobs('queue-test', { jobId: 'feed-job-1' }, now)).verified, 1);
  assert.equal((await verifyJobs('queue-test-duplicate', { jobId: 'feed-job-1' }, now)).unchanged, 1);
  const stored = await read(r => r.get<Job>('jobs', 'feed-job-1'));
  assert.equal(stored?.trust, 'verified');
  assert.equal(stored?.verification?.rulesVersion, 'job-trust-v1');
  assert.equal(await read(r => r.count('jobRiskAssessments', {})), 1);
  assert.equal(await read(r => r.count('auditLogs', { action: 'job.verified' })), 1);
}));

test('unsafe, stale, missing-variant and non-public jobs remain unverified with reasons', async () => sandbox(async () => {
  await seedTrustedFeed(job({ description: 'Pay a registration fee and send your OTP to proceed.' }));
  await transaction(async r => {
    await r.put('jobFeedSources', { id: 'feed-source', enabled: true, approved: true, publicListing: false, publish: true, intervalMinutes: 30 });
    await r.put('jobFeedStates', { id: 'feed-source', status: 'failed', failures: 4, lastSuccessAt: '2026-09-01T00:00:00.000Z' });
    await r.remove('jobFeedVariants', 'variant-1');
  });
  const evaluation = await read(r => evaluateJobVerification(r, job({ description: 'Pay a registration fee and send your OTP to proceed.' }), now));
  assert.equal(evaluation.eligible, false);
  for (const reason of ['SOURCE_NOT_PUBLIC', 'SOURCE_NOT_HEALTHY', 'ACTIVE_SOURCE_VARIANT_MISSING', 'FRAUD_REVIEW_REQUIRED']) assert.ok(evaluation.reasonCodes.includes(reason));
  const result = await verifyJobs('queue-test', { jobId: 'feed-job-1' }, now);
  assert.equal(result.withheld, 1);
  assert.equal((await read(r => r.get<Job>('jobs', 'feed-job-1')))?.trust, 'pending');
}));
