import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  configureDiscoveryPolicy,
  defaultDiscoveryPolicy,
  discoveryOverview,
  expireStaleDiscoveries,
  runDiscovery,
} from '../src/lib/job-discovery.ts';
import {
  createJobSource,
  SourceAdapterRegistry,
  SourceProviderError,
  type JobSourceAdapter,
} from '../src/lib/job-source-strategy.ts';
import { read, transaction } from '../src/lib/store.ts';

async function sandbox(run: () => Promise<void>) {
  const cwd = process.cwd(), env = { ...process.env };
  const directory = await mkdtemp(path.join(tmpdir(), 'skillonit-discovery-'));
  process.chdir(directory); process.env.DEMO_MODE = 'true'; delete process.env.MONGODB_URI;
  try { await run(); } finally { process.chdir(cwd); process.env = env; await rm(directory, { recursive: true, force: true }); }
}
const sourceInput = (board: string, jurisdictions = ['global']) => ({
  name: `Source ${board}`, provider: 'greenhouse' as const, configuration: { board }, enabled: true,
  compliance: { status: 'approved' as const, policyEvidence: 'Approved official provider API for isolated discovery validation.', permittedMethod: 'official_api' as const, jurisdictions },
  schedule: { intervalMinutes: 60 }, rate: { requestsPerMinute: 5 },
  retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 },
});

test('discovery selects an approved portfolio and reports partial provider failure', async () => sandbox(async () => {
  const now = new Date('2026-01-02T00:00:00.000Z');
  const good = await createJobSource('admin', sourceInput('good', ['IN']), now);
  const bad = await createJobSource('admin', sourceInput('bad', ['IN']), now);
  await configureDiscoveryPolicy('admin', { ...defaultDiscoveryPolicy(), maxSourcesPerRun: 2 });
  const adapter: JobSourceAdapter = { provider: 'greenhouse', async fetch(source) {
    if (source.id === bad.id) throw new SourceProviderError('SOURCE_PROVIDER_UNAVAILABLE', 'transient', true);
    return { fetchedAt: now.toISOString(), records: [{ externalId: 'record-1', title: 'Engineer',
      url: 'https://jobs.example.test/record-1', description: 'Provider supplied job facts', location: 'Pune' }] };
  } };
  const run = await runDiscovery('manual', 'admin', { sourceIds: [good.id, bad.id], jurisdiction: 'IN' }, new SourceAdapterRegistry([adapter]), now);
  assert.equal(run.status, 'DEGRADED'); assert.equal(run.successfulSources, 1); assert.equal(run.failedSources, 1);
  assert.equal(run.recordsAcquired, 1); assert.equal(run.results.find(row => row.sourceId === bad.id)?.code, 'SOURCE_PROVIDER_UNAVAILABLE');
  assert.equal(await read(r => r.count('jobSourceVariants', { sourceId: good.id })), 1);
  const persisted = await read(r => r.get<any>('jobDiscoveryRuns', run.id));
  assert.equal(persisted.status, 'DEGRADED'); assert.equal(JSON.stringify(persisted).includes('Provider supplied job facts'), false);
  const overview = await discoveryOverview(now);
  assert.equal(overview.recentRuns[0].id, run.id); assert.equal(overview.health.configuredSources, 2);
}));

test('discovery enforces jurisdiction and due scheduling without bypassing leases', async () => sandbox(async () => {
  const now = new Date('2026-01-03T00:00:00.000Z');
  const india = await createJobSource('admin', sourceInput('india', ['IN']), now);
  await createJobSource('admin', sourceInput('us', ['US']), now);
  const calls: string[] = [];
  const adapter: JobSourceAdapter = { provider: 'greenhouse', async fetch(source) {
    calls.push(source.id); return { fetchedAt: now.toISOString(), records: [] };
  } };
  const run = await runDiscovery('scheduled', 'job-discovery-scheduler', { jurisdiction: 'IN' }, new SourceAdapterRegistry([adapter]), now);
  assert.equal(run.status, 'COMPLETED'); assert.deepEqual(calls, [india.id]);
  const second = await runDiscovery('scheduled', 'job-discovery-scheduler', { jurisdiction: 'IN' }, new SourceAdapterRegistry([adapter]), now);
  assert.equal(second.status, 'EMPTY'); assert.equal(calls.length, 1);
}));

test('discovery expires old variants and honors the global policy pause', async () => sandbox(async () => {
  await transaction(r => r.put('jobSourceVariants', {
    id: 'stale-variant', sourceId: 'source', sourceJobId: 'old', status: 'needs_normalization',
    fetchedAt: '2025-01-01T00:00:00.000Z',
  }));
  assert.equal(await expireStaleDiscoveries(defaultDiscoveryPolicy(), new Date('2026-01-01T00:00:00.000Z')), 1);
  assert.equal((await read(r => r.get<any>('jobSourceVariants', 'stale-variant'))).status, 'stale');
  await configureDiscoveryPolicy('admin', { ...defaultDiscoveryPolicy(), enabled: false });
  const run = await runDiscovery('scheduled', 'job-discovery-scheduler');
  assert.equal(run.status, 'PAUSED'); assert.equal(run.selectedSources, 0); assert.ok(run.finishedAt);
  assert.equal((await read(r => r.get<any>('jobDiscoveryRuns', run.id))).status, 'PAUSED');
}));
