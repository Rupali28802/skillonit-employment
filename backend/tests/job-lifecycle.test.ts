import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Job } from '../src/lib/domain.ts';
import { defaultLifecyclePolicy, effectiveExpiry, expireJobs, isLifecycleActive, jobFreshness, lifecyclePolicySchema, lifecycleState, transitionJobLifecycle } from '../src/lib/lifecycle.ts';
import { read, transaction } from '../src/lib/store.ts';

async function sandbox(run: () => Promise<void>) {
  const cwd = process.cwd(), env = { ...process.env }, directory = await mkdtemp(path.join(tmpdir(), 'skillonit-lifecycle-'));
  process.chdir(directory); process.env.DEMO_MODE = 'true'; delete process.env.MONGODB_URI;
  try { await run(); } finally { process.chdir(cwd); process.env = env; await rm(directory, { recursive: true, force: true }); }
}
const job = (id: string, overrides: Partial<Job> = {}): Job => ({ id, title: 'Engineer', company: 'Example', domain: 'example.test', country: 'India', state: '', city: 'Pune', category: 'Technology', skills: ['TypeScript'], mode: 'Remote', type: 'Full-time', salaryMin: 1, salaryMax: 2, currency: 'INR', experienceMin: 1, experienceMax: 2, description: 'Build software.', requirements: 'TypeScript', method: 'direct', status: 'review', trust: 'verified', employerId: 'employer', source: 'Employer submission', discoveredAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-04-01T00:00:00.000Z', lifecycle: { schemaVersion: 1, state: 'publishing', revision: 0, changedAt: '2026-01-01T00:00:00.000Z', reasonCode: 'CREATED' }, ...overrides });

test('verified publishing job becomes active with compatibility status and an audit trail', async () => sandbox(async () => {
  await transaction(r => r.put('jobs', job('job-one')));
  const active = await transaction(r => transitionJobLifecycle(r, 'job-one', 'active', 'admin', 'ADMIN_PUBLISHED', { expectedRevision: 0, now: new Date('2026-01-02T00:00:00.000Z') }));
  assert.equal(active.status, 'published'); assert.equal(active.lifecycle?.state, 'active'); assert.equal(active.lifecycle?.revision, 1);
  assert.equal(isLifecycleActive(active, 90, new Date('2026-01-02T00:00:00.000Z')), true);
  const event = await read(r => r.get<any>('jobLifecycleEvents', 'job-one:1'));
  assert.deepEqual({ from: event.from, to: event.to, reasonCode: event.reasonCode }, { from: 'publishing', to: 'active', reasonCode: 'ADMIN_PUBLISHED' });
}));

test('publishing fails closed for unverified, future or stale jobs', async () => sandbox(async () => {
  await transaction(async r => {
    await r.put('jobs', job('unverified', { trust: 'pending' }));
    await r.put('jobs', job('future', { discoveredAt: '2026-02-01T00:00:00.000Z', expiresAt: '2026-03-01T00:00:00.000Z' }));
    await r.put('jobs', job('stale', { discoveredAt: '2025-01-01T00:00:00.000Z', expiresAt: '2025-02-01T00:00:00.000Z' }));
  });
  await assert.rejects(transaction(r => transitionJobLifecycle(r, 'unverified', 'active', 'admin', 'TEST', { now: new Date('2026-01-02T00:00:00.000Z') })), (error: any) => error.code === 'JOB_VERIFICATION_REQUIRED');
  await assert.rejects(transaction(r => transitionJobLifecycle(r, 'future', 'active', 'admin', 'TEST', { now: new Date('2026-01-02T00:00:00.000Z') })), (error: any) => error.code === 'JOB_NOT_FRESH');
  await assert.rejects(transaction(r => transitionJobLifecycle(r, 'stale', 'active', 'admin', 'TEST', { now: new Date('2026-01-02T00:00:00.000Z') })), (error: any) => error.code === 'JOB_NOT_FRESH');
}));

test('expiry worker distinguishes natural expiry from employer closure and is idempotent', async () => sandbox(async () => {
  await transaction(async r => {
    await r.put('jobs', job('expired', { status: 'published', discoveredAt: '2025-10-01T00:00:00.000Z', expiresAt: '2026-01-01T00:00:00.000Z', lifecycle: { schemaVersion: 1, state: 'active', revision: 1, changedAt: '2025-10-01T00:00:00.000Z', reasonCode: 'PUBLISHED' } }));
    await r.put('jobs', job('current', { status: 'published', discoveredAt: '2025-12-15T00:00:00.000Z', expiresAt: '2026-03-01T00:00:00.000Z', lifecycle: { schemaVersion: 1, state: 'active', revision: 1, changedAt: '2025-12-15T00:00:00.000Z', reasonCode: 'PUBLISHED' } }));
  });
  assert.equal(await expireJobs(new Date('2026-01-02T00:00:00.000Z')), 1);
  assert.equal(await expireJobs(new Date('2026-01-02T00:00:00.000Z')), 0);
  const expired = await read(r => r.get<Job>('jobs', 'expired')), current = await read(r => r.get<Job>('jobs', 'current'));
  assert.equal(expired?.lifecycle?.state, 'expired'); assert.equal(expired?.status, 'closed'); assert.equal(current?.lifecycle?.state, 'active');
  await transaction(r => transitionJobLifecycle(r, 'current', 'closed', 'employer', 'EMPLOYER_CLOSED', { now: new Date('2026-01-03T00:00:00.000Z') }));
  assert.equal((await read(r => r.get<Job>('jobs', 'current')))?.lifecycle?.state, 'closed');
}));

test('removed is terminal and reposted records identify the replacement', async () => sandbox(async () => {
  await transaction(async r => {
    await r.put('jobs', job('old', { status: 'closed', lifecycle: { schemaVersion: 1, state: 'closed', revision: 1, changedAt: '2026-01-02T00:00:00.000Z', reasonCode: 'CLOSED' } }));
    await r.put('jobs', job('remove-me'));
  });
  const reposted = await transaction(r => transitionJobLifecycle(r, 'old', 'reposted', 'worker', 'REPOST_DISCOVERED', { relatedJobId: 'new', now: new Date('2026-02-01T00:00:00.000Z') }));
  assert.equal(reposted.lifecycle?.state, 'reposted'); assert.equal((reposted as any).repostedBy, 'new');
  const removed = await transaction(r => transitionJobLifecycle(r, 'remove-me', 'removed', 'admin', 'ADMIN_REMOVED'));
  assert.equal(removed.status, 'disabled'); assert.equal(removed.lifecycle?.state, 'removed');
  await assert.rejects(transaction(r => transitionJobLifecycle(r, 'remove-me', 'active', 'admin', 'INVALID')), (error: any) => error.code === 'INVALID_LIFECYCLE_TRANSITION');
}));

test('freshness uses the earlier declared or retention expiry without changing job data', () => {
  const config = defaultLifecyclePolicy(), active = job('fresh', { status: 'published', lifecycle: { schemaVersion: 1, state: 'active', revision: 1, changedAt: '2026-01-01T00:00:00.000Z', reasonCode: 'PUBLISHED' } });
  assert.equal(jobFreshness(active, config, new Date('2026-01-10T00:00:00.000Z')), 'fresh');
  assert.equal(jobFreshness(active, config, new Date('2026-03-05T00:00:00.000Z')), 'aging');
  assert.equal(jobFreshness(active, config, new Date('2026-04-02T00:00:00.000Z')), 'stale');
  assert.equal(effectiveExpiry(active, 90).toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(lifecycleState({ ...active, lifecycle: undefined, status: 'disabled' }), 'removed');
  assert.throws(() => lifecyclePolicySchema.parse({ activeDays: 30, agingAfterDays: 30 }));
});
