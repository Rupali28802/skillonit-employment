import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Job } from '../src/lib/domain.ts';
import { canonicalIdentityFingerprint, defaultDeduplicationPolicy, deduplicationPolicySchema, resolveCanonicalJob } from '../src/lib/job-deduplication.ts';
import { read, transaction } from '../src/lib/store.ts';

async function sandbox(run: () => Promise<void>) {
  const cwd = process.cwd(), env = { ...process.env }, directory = await mkdtemp(path.join(tmpdir(), 'skillonit-dedupe-'));
  process.chdir(directory); process.env.DEMO_MODE = 'true'; delete process.env.MONGODB_URI;
  try { await run(); } finally { process.chdir(cwd); process.env = env; await rm(directory, { recursive: true, force: true }); }
}
const job = (id: string, overrides: Partial<Job> = {}): Job => ({ id, title: 'Senior Software Engineer', company: 'Example Incorporated', domain: 'example.test', country: 'India', state: 'Maharashtra', city: 'Pune', category: 'Technology', skills: ['TypeScript'], mode: 'Hybrid', type: 'Full-time', salaryMin: 100, salaryMax: 200, currency: 'INR', experienceMin: 3, experienceMax: 6, description: 'Build reliable TypeScript services for enterprise customers and improve platform reliability.', requirements: 'TypeScript distributed systems APIs testing and security.', method: 'external', url: `https://example.test/jobs/${id}`, status: 'review', trust: 'pending', employerId: 'employer-one', source: 'source-one', discoveredAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z', ...overrides });
const reference = (variantId: string, sourceId = 'source-one', sourceJobId = variantId) => ({ variantId, sourceId, sourceJobId, fetchedAt: '2026-01-01T00:00:00.000Z', provenance: { provider: 'greenhouse', sourceUrl: `https://${sourceId}.test/${sourceJobId}`, permittedMethod: 'official_api' } });

test('exact duplicates across sources collapse into one canonical opportunity and preserve references', async () => sandbox(async () => {
  const first = await transaction(r => resolveCanonicalJob(r, job('job-one'), reference('variant-one')));
  const second = await transaction(r => resolveCanonicalJob(r, job('job-two', { source: 'source-two' }), reference('variant-two', 'source-two')));
  assert.equal(first.kind, 'unique'); assert.equal(second.kind, 'duplicate'); assert.equal(second.canonicalJobId, first.canonicalJobId);
  assert.equal(await read(r => r.count('jobs', { domain: 'example.test' })), 1);
  assert.equal(await read(r => r.count('jobSourceReferences')), 2);
  const canonical = await read(r => r.get<any>('jobs', first.canonicalJobId));
  assert.deepEqual(new Set(canonical.sourceVariantIds), new Set(['variant-one', 'variant-two']));
  assert.equal(canonical.provenance.length, 2);
}));

test('high-confidence normalized content detects reordered-title cross-source duplicates', async () => sandbox(async () => {
  const first = await transaction(r => resolveCanonicalJob(r, job('job-one'), reference('variant-one')));
  const second = await transaction(r => resolveCanonicalJob(r, job('job-two', { title: 'Software Engineer Senior', source: 'source-two' }), reference('variant-two', 'source-two')));
  assert.equal(second.kind, 'duplicate'); assert.equal(second.reasonCode, 'SEMANTIC_IDENTITY'); assert.equal(second.identityId, first.identityId);
}));

test('different opportunities at the same employer are not collapsed', async () => sandbox(async () => {
  await transaction(r => resolveCanonicalJob(r, job('job-one'), reference('variant-one')));
  const other = await transaction(r => resolveCanonicalJob(r, job('job-two', { title: 'Finance Director', category: 'Finance', description: 'Lead corporate accounting tax treasury and financial reporting.', requirements: 'Chartered accountant with finance leadership experience.' }), reference('variant-two', 'source-two')));
  assert.equal(other.kind, 'unique'); assert.equal(await read(r => r.count('jobs', { domain: 'example.test' })), 2);
}));

test('a closed or expired opportunity creates a linked repost occurrence', async () => sandbox(async () => {
  const first = await transaction(r => resolveCanonicalJob(r, job('job-one', { status: 'closed', expiresAt: '2026-01-15T00:00:00.000Z' }), reference('variant-one'), new Date('2026-01-10T00:00:00.000Z')));
  const repost = await transaction(r => resolveCanonicalJob(r, job('job-two', { discoveredAt: '2026-03-01T00:00:00.000Z', expiresAt: '2026-06-01T00:00:00.000Z' }), reference('variant-two', 'source-two'), new Date('2026-03-01T00:00:00.000Z')));
  assert.equal(repost.kind, 'repost'); assert.equal(repost.repostOf, first.canonicalJobId); assert.equal(repost.sequence, 2);
  const stored = await read(r => r.get<any>('jobs', repost.canonicalJobId));
  assert.equal(stored.repostOf, first.canonicalJobId); assert.equal(stored.canonicalIdentityId, first.identityId);
  const identity = await read(r => r.get<any>('canonicalJobIdentities', first.identityId));
  assert.equal(identity.occurrenceCount, 2); assert.deepEqual(identity.jobIds, ['job-one', 'job-two']);
}));

test('repeat variants remain idempotent and decisions contain codes rather than source content', async () => sandbox(async () => {
  await transaction(r => resolveCanonicalJob(r, job('job-one'), reference('variant-one')));
  await transaction(r => resolveCanonicalJob(r, job('job-two'), reference('variant-two', 'source-one', 'external-one')));
  await transaction(r => resolveCanonicalJob(r, job('job-three'), reference('variant-three', 'source-one', 'external-one')));
  assert.equal(await read(r => r.count('jobSourceReferences')), 2);
  const ref = (await read(r => r.find<any>('jobSourceReferences', { sourceJobId: 'external-one' }, 1)))[0];
  assert.deepEqual(ref.variantIds, ['variant-two', 'variant-three']);
  const decisions = await read(r => r.find<any>('jobDeduplicationDecisions', {}, 10));
  assert.equal(JSON.stringify(decisions).includes('Build reliable'), false);
}));

test('canonical fingerprint is normalization-stable and policy is bounded', () => {
  assert.equal(canonicalIdentityFingerprint(job('one')), canonicalIdentityFingerprint(job('two', { title: '  SENIOR  SOFTWARE ENGINEER ' })));
  assert.equal(defaultDeduplicationPolicy().version, 'job-dedupe-v1');
  assert.throws(() => deduplicationPolicySchema.parse({ titleSimilarity: 0.5 }));
});
