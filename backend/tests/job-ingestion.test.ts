import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureIngestionPolicy, defaultIngestionPolicy, ingestionOverview, runIngestion, runIngestionWithCoverageAudit, type JobIndexSink } from '../src/lib/job-ingestion.ts';
import { read, transaction } from '../src/lib/store.ts';

async function sandbox(run: () => Promise<void>) {
  const cwd = process.cwd(), env = { ...process.env }, directory = await mkdtemp(path.join(tmpdir(), 'skillonit-ingestion-'));
  process.chdir(directory); process.env.DEMO_MODE = 'true'; delete process.env.MONGODB_URI;
  try { await run(); } finally { process.chdir(cwd); process.env = env; await rm(directory, { recursive: true, force: true }); }
}
const source = { id: 'source-one', name: 'Example Incorporated', enabled: true, compliance: { status: 'approved', permittedMethod: 'official_api' } };
const variant = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, sourceId: source.id, sourceJobId: id, fetchedAt: '2026-01-01T00:00:00.000Z', status: 'needs_normalization',
  provenance: { provider: 'greenhouse', sourceUrl: `https://jobs.example.test/${id}`, permittedMethod: 'official_api' },
  normalized: { id, title: 'Senior Engineer', url: `https://jobs.example.test/${id}`, description: 'Build secure software for customers.', city: 'Pune',
    company: 'Example Incorporated', domain: 'example.test', country: 'India', category: 'Technology', skills: ['TypeScript'], mode: 'Hybrid', type: 'Full-time',
    salaryMin: 100, salaryMax: 200, currency: 'INR', experienceMin: 3, experienceMax: 6, employerId: 'employer-one', sourceUpdatedAt: '2026-01-01T00:00:00.000Z', ...overrides },
});
const sink: JobIndexSink = { async index() { return 'not_eligible'; } };

test('ingestion completes every stage and stores a review-only canonical job', async () => sandbox(async () => {
  await transaction(async r => { await r.put('jobSources', source); await r.put('jobSourceVariants', variant('variant-one')); });
  const result = await runIngestion('admin', sink, new Date('2026-01-02T00:00:00.000Z'));
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.processed, 1); assert.equal(result.failed, 0);
  const storedVariant = await read(r => r.get<any>('jobSourceVariants', 'variant-one'));
  const job = await read(r => r.get<any>('jobs', storedVariant.jobId));
  assert.equal(storedVariant.status, 'stored'); assert.equal(job.status, 'review'); assert.equal(job.trust, 'pending');
  assert.equal(job.sourceVariantIds[0], 'variant-one'); assert.equal(job.provenance[0].sourceJobId, 'variant-one');
  assert.equal(job.feed.sourceId, source.id); assert.equal(job.feed.lastSeenAt, '2026-01-01T00:00:00.000Z');
  assert.equal(job.sourceUpdatedAt, '2026-01-01T00:00:00.000Z');
  const events = await read(r => r.find<any>('jobIngestionEvents', { variantId: 'variant-one' }, 50));
  for (const stage of ['fetch', 'parse', 'normalize', 'validate', 'verify', 'enrich', 'deduplicate', 'store', 'index']) assert.ok(events.some(row => row.stage === stage), stage);
  assert.equal(JSON.stringify(events).includes('Build secure software'), false);
}));

test('ingestion writes the coverage snapshot after processing a new India listing', async () => sandbox(async () => {
  await transaction(async r => { await r.put('jobSources', source); await r.put('jobSourceVariants', variant('coverage-one')); });
  const result = await runIngestionWithCoverageAudit('admin', sink, new Date('2026-01-02T00:00:00.000Z'));
  assert.equal(result.status, 'COMPLETED');
  const audit = await read(r => r.get<any>('jobEngineState', 'coverage-latest'));
  assert.ok(audit.generatedAt);
  assert.equal(audit.india.localListings, 0);
  assert.equal(audit.india.eligibleListings, 0);
}));

test('ingestion collapses duplicate records while preserving provenance', async () => sandbox(async () => {
  await transaction(async r => { await r.put('jobSources', source); await r.put('jobSourceVariants', variant('variant-one')); await r.put('jobSourceVariants', variant('variant-two')); });
  const result = await runIngestion('admin', sink, new Date('2026-01-02T00:00:00.000Z'));
  assert.equal(result.processed, 2); assert.equal(await read(r => r.count('jobs', { source: source.id })), 1);
  const jobs = await read(r => r.find<any>('jobs', { source: source.id }, 10));
  assert.deepEqual(new Set(jobs[0].sourceVariantIds), new Set(['variant-one', 'variant-two']));
  assert.equal(jobs[0].provenance.length, 2);
  assert.equal((await read(r => r.get<any>('jobSourceVariants', 'variant-two'))).deduplicated, true);
  assert.equal(await read(r => r.count('canonicalJobIdentities')), 1);
  assert.equal(await read(r => r.count('jobSourceReferences')), 2);
  assert.equal(await read(r => r.count('jobDeduplicationDecisions')), 2);
}));

test('a newly discovered occurrence after closure is stored as a linked repost', async () => sandbox(async () => {
  await transaction(async r => { await r.put('jobSources', source); await r.put('jobSourceVariants', variant('variant-one')); });
  await runIngestion('admin', sink, new Date('2026-01-02T00:00:00.000Z'));
  const original = (await read(r => r.find<any>('jobs', { source: source.id }, 10)))[0];
  await transaction(async r => {
    await r.put('jobs', { ...original, status: 'closed' });
    await r.put('jobSourceVariants', variant('variant-repost', { discoveredAt: '2026-02-01T00:00:00.000Z', expiresAt: '2026-05-01T00:00:00.000Z' }));
  });
  const result = await runIngestion('admin', sink, new Date('2026-02-02T00:00:00.000Z'));
  assert.equal(result.results[0].status, 'stored');
  const repostVariant = await read(r => r.get<any>('jobSourceVariants', 'variant-repost'));
  const repost = await read(r => r.get<any>('jobs', repostVariant.jobId));
  assert.equal(repost.repostOf, original.id); assert.equal(repost.repostSequence, 2);
  assert.equal(repost.canonicalIdentityId, original.canonicalIdentityId);
}));

test('invalid and suspicious records cannot enter public search', async () => sandbox(async () => {
  await transaction(async r => {
    await r.put('jobSources', source);
    await r.put('jobSourceVariants', { ...variant('invalid'), normalized: { ...variant('invalid').normalized, url: 'http://unsafe.example.test' } });
    await r.put('jobSourceVariants', variant('risky', { description: 'Pay a registration fee and send your OTP.', email: 'attacker@other.test' }));
  });
  const result = await runIngestion('admin', sink, new Date('2026-01-02T00:00:00.000Z'));
  assert.equal(result.status, 'DEGRADED');
  assert.equal((await read(r => r.get<any>('jobSourceVariants', 'invalid'))).status, 'quarantined');
  const riskyVariant = await read(r => r.get<any>('jobSourceVariants', 'risky'));
  const risky = await read(r => r.get<any>('jobs', riskyVariant.jobId));
  assert.equal(risky.status, 'review'); assert.equal(risky.trust, 'flagged');
}));

test('policy pause and overview are persisted and auditable', async () => sandbox(async () => {
  await configureIngestionPolicy('admin', { ...defaultIngestionPolicy(), enabled: false });
  const result = await runIngestion('admin', sink); assert.equal(result.status, 'PAUSED');
  const overview = await ingestionOverview(); assert.equal(overview.policy.enabled, false); assert.equal(overview.recentRuns.length, 1);
  assert.equal(await read(r => r.count('auditLogs', { action: 'ingestion.policy_updated' })), 1);
}));

test('index failures retry the stored canonical job without duplicating it', async () => sandbox(async () => {
  await transaction(async r => { await r.put('jobSources', source); await r.put('jobSourceVariants', variant('retry-one')); });
  const failed = await runIngestion('worker', { async index() { throw new Error('private provider detail'); } }, new Date('2026-01-02T00:00:00.000Z'));
  assert.equal(failed.results[0].status, 'retry');
  const pending = await read(r => r.get<any>('jobSourceVariants', 'retry-one')); assert.equal(pending.status, 'index_pending');
  await transaction(r => r.put('jobSourceVariants', { ...pending, retryAt: '2026-01-02T00:00:00.000Z' }));
  const retried = await runIngestion('worker', sink, new Date('2026-01-02T00:01:00.000Z'));
  assert.equal(retried.results[0].status, 'stored'); assert.equal(await read(r => r.count('jobs', { source: source.id })), 1);
  assert.equal(JSON.stringify(await read(r => r.find('jobIngestionEvents', {}, 100))).includes('private provider detail'), false);
}));
