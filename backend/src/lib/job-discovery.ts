import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError, audit } from './security.js';
import { read, transaction } from './store.js';
import { saveCoverageAudit } from '../job-engine/coverage.js';
import {
  SourceAdapterRegistry,
  claimDueJobSources,
  fetchJobSource,
  listJobSources,
  type JobSource,
} from './job-source-strategy.js';

export const discoveryPolicySchema = z.object({
  enabled: z.boolean(),
  maxSourcesPerRun: z.number().int().min(1).max(100),
  freshnessHours: z.number().int().min(1).max(720),
  variantRetentionDays: z.number().int().min(1).max(90),
  minimumHealthySources: z.number().int().min(1).max(100),
});
export type DiscoveryPolicy = z.infer<typeof discoveryPolicySchema>;
export const defaultDiscoveryPolicy = (): DiscoveryPolicy => ({
  enabled: true,
  maxSourcesPerRun: 20,
  freshnessHours: 24,
  variantRetentionDays: 90,
  minimumHealthySources: 1,
});
export const discoveryRequestSchema = z.object({
  sourceIds: z.array(z.string().uuid()).max(100).optional(),
  jurisdiction: z.string().trim().min(2).max(80).optional(),
});

export type DiscoveryRunStatus = 'RUNNING' | 'COMPLETED' | 'DEGRADED' | 'FAILED' | 'EMPTY' | 'PAUSED';
export type DiscoveryRun = {
  id: string;
  schemaVersion: 1;
  trigger: 'scheduled' | 'manual';
  actorId: string;
  correlationId: string;
  jurisdiction?: string;
  requestedSourceIds?: string[];
  status: DiscoveryRunStatus;
  startedAt: string;
  finishedAt?: string;
  selectedSources: number;
  successfulSources: number;
  failedSources: number;
  recordsAcquired: number;
  staleVariants: number;
  results: { sourceId: string; status: 'succeeded' | 'failed'; count: number; code?: string }[];
};

export async function discoveryPolicy() {
  return read(async r => {
    const row = await r.get<{ value: DiscoveryPolicy }>('systemConfig', 'job-discovery-policy');
    return row ? discoveryPolicySchema.parse(row.value) : defaultDiscoveryPolicy();
  });
}

export async function configureDiscoveryPolicy(actorId: string, input: unknown) {
  const value = discoveryPolicySchema.parse(input);
  await transaction(async r => {
    await r.put('systemConfig', { id: 'job-discovery-policy', schemaVersion: 1, value, updatedAt: new Date().toISOString() });
    await audit(r, actorId, 'discovery.policy_updated', 'job-discovery-policy');
  });
  return value;
}

export async function expireStaleDiscoveries(policy: DiscoveryPolicy, now = new Date()) {
  const cutoff = new Date(now.getTime() - policy.variantRetentionDays * 86400000).toISOString();
  let cursor = '', changed = 0;
  for (;;) {
    const batch = await read(r => r.scan<any>('jobSourceVariants', {}, cursor, 250));
    if (!batch.length) return changed;
    changed += await transaction(async r => {
      let count = 0;
      for (const item of batch) {
        if (item.status !== 'stale' && typeof item.fetchedAt === 'string' && item.fetchedAt < cutoff) {
          await r.put('jobSourceVariants', { ...item, status: 'stale', staleAt: now.toISOString() });
          count++;
        }
      }
      return count;
    });
    cursor = batch.at(-1).id;
  }
}

export async function discoveryOverview(now = new Date()) {
  const [policy, sources, runs] = await Promise.all([
    discoveryPolicy(), listJobSources(), read(r => r.find<DiscoveryRun>('jobDiscoveryRuns', {}, 100)),
  ]);
  const freshnessCutoff = new Date(now.getTime() - policy.freshnessHours * 3600000).toISOString();
  const enabled = sources.filter(source => source.enabled && source.compliance.status === 'approved');
  const fresh = enabled.filter(source => source.health.lastSuccessAt && source.health.lastSuccessAt >= freshnessCutoff).length;
  const failed = enabled.filter(source => source.health.status === 'failed').length;
  return {
    policy,
    health: {
      status: !policy.enabled ? 'paused' : fresh >= policy.minimumHealthySources ? (failed ? 'degraded' : 'healthy') : 'degraded',
      configuredSources: sources.length, enabledSources: enabled.length, freshSources: fresh,
      staleSources: enabled.length - fresh, failedSources: failed,
    },
    recentRuns: runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 20),
  };
}

export async function runDiscovery(
  trigger: 'scheduled' | 'manual',
  actorId: string,
  request: unknown = {},
  registry = new SourceAdapterRegistry(),
  now = new Date(),
) {
  const input = discoveryRequestSchema.parse(request);
  const policy = await discoveryPolicy();
  const run: DiscoveryRun = {
    id: randomUUID(), schemaVersion: 1, trigger, actorId, correlationId: randomUUID(),
    ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
    ...(input.sourceIds ? { requestedSourceIds: input.sourceIds } : {}),
    status: policy.enabled ? 'RUNNING' : 'PAUSED', startedAt: now.toISOString(),
    selectedSources: 0, successfulSources: 0, failedSources: 0,
    recordsAcquired: 0, staleVariants: 0, results: [],
  };
  await transaction(async r => {
    await r.put('jobDiscoveryRuns', run);
    await audit(r, actorId, policy.enabled ? 'discovery.started' : 'discovery.paused', run.id);
  });
  if (!policy.enabled) {
    const paused = { ...run, finishedAt: now.toISOString() };
    await transaction(r => r.put('jobDiscoveryRuns', paused));
    return paused;
  }

  let sourceIds: string[];
  try {
    sourceIds = await claimDueJobSources(now, {
      limit: policy.maxSourcesPerRun,
      jurisdiction: input.jurisdiction,
      sourceIds: input.sourceIds,
      force: trigger === 'manual',
    });
  } catch {
    const failed: DiscoveryRun = { ...run, status: 'FAILED', finishedAt: new Date().toISOString(),
      failedSources: 0, results: [] };
    await transaction(async r => {
      await r.put('jobDiscoveryRuns', failed);
      await audit(r, actorId, 'discovery.failed', run.id);
    });
    throw new ApiError(503, 'DISCOVERY_SCHEDULING_FAILED', 'Job discovery could not be scheduled. Retry later.');
  }
  const results: DiscoveryRun['results'] = [];
  for (const sourceId of sourceIds) {
    try {
      const result = await fetchJobSource(sourceId, run.correlationId, actorId, registry, now);
      results.push({ sourceId, status: 'succeeded', count: result.fetched });
    } catch (error) {
      results.push({
        sourceId, status: 'failed', count: 0,
        code: error instanceof ApiError ? error.code : 'DISCOVERY_SOURCE_FAILED',
      });
    }
  }
  let staleVariants: number;
  try { staleVariants = await expireStaleDiscoveries(policy, now); }
  catch {
    const failed: DiscoveryRun = {
      ...run, status: 'FAILED', finishedAt: new Date().toISOString(), selectedSources: results.length,
      successfulSources: results.filter(result => result.status === 'succeeded').length,
      failedSources: results.filter(result => result.status === 'failed').length,
      recordsAcquired: results.reduce((sum, result) => sum + result.count, 0), results,
    };
    await transaction(async r => {
      await r.put('jobDiscoveryRuns', failed);
      await audit(r, actorId, 'discovery.failed', run.id);
    });
    throw new ApiError(503, 'DISCOVERY_FRESHNESS_FAILED', 'Discovery freshness maintenance failed. Retry later.');
  }
  const successful = results.filter(result => result.status === 'succeeded').length;
  const failed = results.length - successful;
  const status: DiscoveryRunStatus = !results.length ? 'EMPTY' : failed === 0 ? 'COMPLETED' : successful ? 'DEGRADED' : 'FAILED';
  const completed: DiscoveryRun = {
    ...run, status, finishedAt: new Date().toISOString(), selectedSources: results.length,
    successfulSources: successful, failedSources: failed,
    recordsAcquired: results.reduce((sum, result) => sum + result.count, 0), staleVariants, results,
  };
  await transaction(async r => {
    await r.put('jobDiscoveryRuns', completed);
    await audit(r, actorId, `discovery.${status.toLowerCase()}`, run.id);
  });
  return completed;
}

export async function runScheduledDiscovery(registry = new SourceAdapterRegistry(), now = new Date()) {
  const result = await runDiscovery('scheduled', 'job-discovery-scheduler', {}, registry, now);
  await saveCoverageAudit();
  return result;
}
