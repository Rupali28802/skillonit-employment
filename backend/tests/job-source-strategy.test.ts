import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  GreenhouseSourceAdapter,
  SourceAdapterRegistry,
  SourceProviderError,
  claimDueJobSources,
  createJobSource,
  fetchJobSource,
  listJobSources,
  sourceEvents,
  updateJobSource,
  type JobSourceAdapter,
} from '../src/lib/job-source-strategy.ts';
import { read } from '../src/lib/store.ts';

const approved = {
  name: 'Example careers', provider: 'greenhouse' as const,
  configuration: { board: 'example' }, enabled: true,
  compliance: {
    status: 'approved' as const,
    policyEvidence: 'Approved official API integration for automated tests only.',
    permittedMethod: 'official_api' as const,
    jurisdictions: ['global'],
  },
  schedule: { intervalMinutes: 60 }, rate: { requestsPerMinute: 2 },
  retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 },
};

async function sandbox(run: () => Promise<void>) {
  const previous = process.cwd(), env = { ...process.env };
  const directory = await mkdtemp(path.join(tmpdir(), 'skillonit-sources-'));
  process.chdir(directory); process.env.DEMO_MODE = 'true'; delete process.env.MONGODB_URI;
  try { await run(); }
  finally {
    process.chdir(previous); process.env = env;
    await rm(directory, { recursive: true, force: true });
  }
}

test('Greenhouse adapter enforces the official response contract and classifies provider failures', async () => {
  const source = { ...approved, id: 's1', schemaVersion: 1 as const, revision: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), reviewedBy: 'a', reviewedAt: new Date().toISOString(),
    nextRunAt: new Date().toISOString(), health: { status: 'idle' as const, consecutiveFailures: 0 } };
  const adapter = new GreenhouseSourceAdapter(async () => Response.json({ jobs: [{
    id: 42, title: 'Engineer', absolute_url: 'https://jobs.example.test/42',
    content: '<p>Build safe systems</p>', location: { name: 'Pune' },
  }] }));
  const result = await adapter.fetch(source, AbortSignal.timeout(1000));
  assert.equal(result.records[0].description, 'Build safe systems');
  assert.equal(result.records[0].externalId, '42');
  const limited = new GreenhouseSourceAdapter(async () => new Response('', { status: 429 }));
  await assert.rejects(limited.fetch(source, AbortSignal.timeout(1000)), (error: SourceProviderError) =>
    error.code === 'SOURCE_RATE_LIMITED' && error.classification === 'rate_limit' && error.retryable);
});

test('source lifecycle persists provenance, health, retries and redacted audit events', async () => sandbox(async () => {
  const created = await createJobSource('admin-1', approved, new Date('2026-01-01T00:00:00.000Z'));
  assert.equal(created.schemaVersion, 1); assert.equal(created.health.status, 'idle');
  const adapter: JobSourceAdapter = { provider: 'greenhouse', async fetch() { return {
    fetchedAt: '2026-01-01T00:00:01.000Z', records: [{ externalId: 'job-1', title: 'Engineer',
      url: 'https://jobs.example.test/job-1', description: 'Confirmed provider text', location: 'Pune' }],
  }; } };
  const success = await fetchJobSource(created.id, 'correlation-safe', 'admin-1', new SourceAdapterRegistry([adapter]), new Date('2026-01-01T00:00:00.000Z'));
  assert.deepEqual(success, { sourceId: created.id, fetched: 1, status: 'succeeded' });
  const variants = await read(r => r.find<any>('jobSourceVariants', { sourceId: created.id }));
  assert.equal(variants.length, 1); assert.equal(variants[0].sourceJobId, 'job-1');
  assert.equal(variants[0].provenance.permittedMethod, 'official_api');
  assert.equal((await sourceEvents(created.id)).length, 2);
  const current = (await listJobSources())[0]; assert.equal(current.health.lastSuccessAt, '2026-01-01T00:00:01.000Z');
  await assert.rejects(updateJobSource('admin-1', created.id, { revision: 99, name: 'Conflict' }), /changed/);

  const failed: JobSourceAdapter = { provider: 'greenhouse', async fetch() {
    throw new SourceProviderError('SOURCE_PROVIDER_UNAVAILABLE', 'transient', true);
  } };
  await assert.rejects(fetchJobSource(created.id, 'correlation-failure', 'source-scheduler', new SourceAdapterRegistry([failed]), new Date('2026-01-01T00:10:00.000Z')), /temporarily unavailable/);
  const degraded = (await listJobSources())[0];
  assert.equal(degraded.health.status, 'degraded'); assert.equal(degraded.health.lastErrorCode, 'SOURCE_PROVIDER_UNAVAILABLE');
  const serialized = JSON.stringify(await sourceEvents(created.id));
  assert.equal(serialized.includes('Confirmed provider text'), false);
}));

test('scheduler claims only approved, enabled and due sources', async () => sandbox(async () => {
  const due = await createJobSource('admin-1', approved, new Date('2026-01-01T00:00:00.000Z'));
  await createJobSource('admin-1', { ...approved, name: 'Disabled', configuration: { board: 'disabled' }, enabled: false }, new Date('2026-01-01T00:00:00.000Z'));
  const claimed = await claimDueJobSources(new Date('2026-01-01T00:00:01.000Z'));
  assert.deepEqual(claimed, [due.id]);
  assert.deepEqual(await claimDueJobSources(new Date('2026-01-01T00:00:02.000Z')), []);
}));
