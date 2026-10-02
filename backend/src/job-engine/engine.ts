import { randomUUID } from 'node:crypto';
import { read, transaction, type Repository } from '../lib/store.js';
import { expireJobs } from '../lib/lifecycle.js';
import type { Job } from '../lib/domain.js';
import { fetchFeed, FeedError, type FeedBatch } from './adapters.js';
import { normalize, duplicateKey, hash } from './normalize.js';
import { sourceSchema, type FeedSource } from './sources.js';

type Lease = { id: string; owner: string; until: number };
type Variant = { id: string; sourceId: string; jobId: string; lastSeenRun: string; missing: number; active: boolean };
export type SourceState = { id: string; nextRunAt: number; failures: number; status: string; lastSuccessAt?: string; lastAttemptAt?: string; errorCode?: string; counts?: Counts };
type Counts = { fetched: number; added: number; updated: number; duplicates: number; rejected: number; closed: number; requests: number; complete: boolean };
const leaseId = 'job-engine';
const verificationContentUnchanged = (left: Job, right: Job) => ['title', 'company', 'description', 'requirements', 'method', 'url', 'email', 'expiresAt', 'sourcePostedAt']
  .every(key => left[key as keyof Job] === right[key as keyof Job]) && left.feed?.sourceId === right.feed?.sourceId && left.feed?.externalId === right.feed?.externalId;
async function fence(r: Repository, owner: string) {
  const lease = await r.get<Lease>('jobEngineState', leaseId);
  if (lease?.owner !== owner || lease.until < Date.now()) throw new FeedError('LEASE_LOST');
  await r.put('jobEngineState', { ...lease, until: Date.now() + 300000 });
}
async function refreshFeed(r: Repository) {
  await r.put('jobEngineState', { id: 'feed-version', version: randomUUID(), updatedAt: new Date().toISOString() });
}
export async function upsertSource(input: unknown) {
  const source = sourceSchema.parse(input);
  await transaction(async r => {
    await r.put('jobFeedSources', source);
    const state = await r.get<SourceState>('jobFeedStates', source.id);
    // Configuration changes must not bypass the source's network cooldown.
    if (!state) await r.put('jobFeedStates', { id: source.id, nextRunAt: 0, failures: 0, status: 'ready' });
  });
  return source;
}

// Change cadence without discarding failures, provider backoff or in-flight claims.
export async function setEmployerRefresh(id: string, intervalMinutes: number) {
  await transaction(async r => {
    const current = await r.get<FeedSource>('jobFeedSources', id);
    if (!current || !['ashby', 'greenhouse', 'lever'].includes(current.type) || !current.enabled || !current.approved || !current.publicListing)
      throw Error('PUBLIC_EMPLOYER_SOURCE_REQUIRED');
    const source = sourceSchema.parse({ ...current, intervalMinutes });
    await r.put('jobFeedSources', source);
    const state = await r.get<SourceState>('jobFeedStates', id);
    if (state && !state.failures && ['completed', 'partial'].includes(state.status) && state.lastSuccessAt) {
      const last = Date.parse(state.lastSuccessAt);
      if (Number.isFinite(last)) await r.put('jobFeedStates', { ...state, nextRunAt: Math.max(Date.now(), last + intervalMinutes * 60000) });
    }
  });
}
async function closeVariant(r: Repository, v: Variant) {
  await r.put('jobFeedVariants', { ...v, active: false });
  const others = await r.find<Variant>('jobFeedVariants', { jobId: v.jobId, active: true }, 1);
  const j = await r.get<Job>('jobs', v.jobId);
  if (j?.feed && j.status === 'published' && (!others.length || j.feed.sourceId === v.sourceId)) {
    await r.put('jobs', { ...j, status: 'closed', feed: { ...j.feed, closedByEngine: true } }); return 1;
  }
  return 0;
}
async function deactivate(sourceId: string, owner: string, runId?: string) {
  let cursor = '', closed = 0;
  for (;;) {
    const rows = await read(r => r.scan<Variant>('jobFeedVariants', { sourceId, active: true }, cursor, 100));
    if (!rows.length) break;
    const changed = await transaction(async r => {
      await fence(r, owner);
      let count = 0;
      for (const row of rows) {
        if (runId && row.lastSeenRun === runId) continue;
        const missing = row.missing + 1;
        if (!runId || missing >= 2) count += await closeVariant(r, { ...row, missing });
        else await r.put('jobFeedVariants', { ...row, missing });
      }
      return count;
    });
    closed += changed;
    cursor = rows[rows.length - 1].id;
  }
  return closed;
}
async function ingest(source: FeedSource, batch: FeedBatch, owner: string, runId: string): Promise<Counts> {
  const counts: Counts = { fetched: batch.jobs.length, added: 0, updated: 0, duplicates: 0, rejected: 0, closed: 0, requests: batch.requests, complete: batch.complete };
  const jobs: Job[] = [];
  for (const raw of batch.jobs) {
    try { jobs.push(normalize(raw, source)); } catch { counts.rejected++; }
  }
  for (let start = 0; start < jobs.length; start += 25) {
    // Transaction callbacks may retry: aggregate counters only after commit.
    const committed = await transaction(async r => {
      await fence(r, owner);
      const current = await r.get<FeedSource>('jobFeedSources', source.id);
      const currentPolicy = sourceSchema.safeParse(current);
      if (!currentPolicy.success || !currentPolicy.data.enabled || !currentPolicy.data.approved || JSON.stringify(currentPolicy.data) !== JSON.stringify(sourceSchema.parse(source))) throw new FeedError('SOURCE_CHANGED');
      const result = { added: 0, updated: 0, duplicates: 0 };
      const chunk = jobs.slice(start, start + 25);
      const variants = new Map((await r.find<Variant>('jobFeedVariants', { id: { $in: chunk.map(j => hash(source.id + ':' + j.feed!.externalId)) } }, 100)).map(v => [v.id, v]));
      const fingerprints = new Map((await r.find<{ id: string; jobId: string; sourceId: string }>('jobFeedFingerprints', { id: { $in: chunk.map(duplicateKey) } }, 100)).map(v => [v.id, v]));
      const ids = [...new Set([...chunk.map(j => j.id), ...[...variants.values()].map(v => v.jobId), ...[...fingerprints.values()].map(v => v.jobId)])];
      const saved = new Map((await r.find<Job>('jobs', { id: { $in: ids } }, 100)).map(j => [j.id, j]));
      const jobWrites = new Map<string, Job>(), variantWrites: Variant[] = [], fingerprintWrites: { id: string; jobId: string; sourceId: string }[] = [];
      for (const candidate of chunk) {
        const variantId = hash(source.id + ':' + candidate.feed!.externalId);
        const previous = variants.get(variantId);
        const key = duplicateKey(candidate), duplicate = fingerprints.get(key);
        const jobId = previous?.jobId || (duplicate && duplicate.sourceId !== source.id ? duplicate.jobId : candidate.id);
        const existing = jobWrites.get(jobId) || saved.get(jobId);
        const isOtherSource = !!existing?.feed && existing.feed.sourceId !== source.id;
        if (!existing) {
          jobWrites.set(jobId, { ...candidate, id: jobId }); result.added++;
        } else if (existing.feed) {
          const blocked = existing.status === 'disabled' || existing.status === 'review' || (existing.status === 'closed' && !existing.feed.closedByEngine);
          const verificationUnchanged = existing.trust === 'verified' && verificationContentUnchanged(existing, candidate);
          jobWrites.set(jobId, { ...candidate, id: jobId, discoveredAt: existing.discoveredAt,
            ...(existing.sourcePostedAt ? { sourcePostedAt: existing.sourcePostedAt } : {}),
            status: blocked ? existing.status : candidate.status,
            trust: verificationUnchanged ? 'verified' : candidate.trust,
            ...(verificationUnchanged && existing.verification ? { verification: existing.verification } : {}) });
          if (isOtherSource) result.duplicates++; else result.updated++;
        } else result.duplicates++;
        const variant = { id: variantId, sourceId: source.id, jobId, lastSeenRun: runId, missing: 0, active: true };
        variantWrites.push(variant); variants.set(variantId, variant);
        if (!duplicate) { const fp = { id: key, jobId, sourceId: source.id }; fingerprintWrites.push(fp); fingerprints.set(key, fp); }
      }
      await r.putMany('jobs', [...jobWrites.values()]);
      await r.putMany('jobFeedVariants', variantWrites);
      await r.putMany('jobFeedFingerprints', fingerprintWrites);
      return result;
    });
    counts.added += committed.added; counts.updated += committed.updated; counts.duplicates += committed.duplicates;
  }
  // Never infer removals from truncated, invalid, or failed responses and rolling aggregate feeds.
  if (batch.complete && batch.snapshot && counts.rejected === 0) counts.closed = await deactivate(source.id, owner, runId);
  return counts;
}
export async function runEngine(discover: (source: FeedSource) => Promise<FeedBatch> = fetchFeed, sourceType?: FeedSource['type']) {
  const owner = randomUUID();
  let acquired = false;
  try {
    acquired = await transaction(async r => {
      const old = await r.get<Lease>('jobEngineState', leaseId);
      if (old && old.until > Date.now()) return false;
      await r.put('jobEngineState', { id: leaseId, owner, until: Date.now() + 300000 }); return true;
    });
  } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
  if (!acquired) return { status: 'busy', results: [] };
  const results: { source: string; status: string; counts?: Counts; errorCode?: string }[] = [];
  try {
    const knownStates = new Map((await read(r => r.find<SourceState>('jobFeedStates', {}, 1000))).map(s => [s.id, s]));
    const providerBlocks = new Map<string, number>();
    let cursor = '';
    for (;;) {
      const sources = await read(r => r.scan<FeedSource>('jobFeedSources', {}, cursor, 50));
      if (!sources.length) break;
      for (const raw of sources) {
        if (sourceType && raw.type !== sourceType) continue;
        const parsed = sourceSchema.safeParse(raw);
        if (!parsed.success) { results.push({ source: raw.id, status: 'invalid_configuration' }); continue; }
        const source = parsed.data;
        if (!providerBlocks.has(source.type)) {
          const provider = await read(r => r.get<{ id: string; until: number }>('jobEngineState', `provider-${source.type}`));
          providerBlocks.set(source.type, provider?.until || 0);
        }
        if (!source.approved || !source.enabled) {
          const closed = await deactivate(source.id, owner);
          if (closed) await transaction(refreshFeed);
          results.push({ source: source.id, status: 'disabled' }); continue;
        }
        if (providerBlocks.get(source.type)! > Date.now()) { results.push({ source: source.id, status: 'provider_backoff' }); continue; }
        const state = knownStates.get(source.id) || await read(r => r.get<SourceState>('jobFeedStates', source.id));
        if ((state?.nextRunAt || 0) > Date.now()) { results.push({ source: source.id, status: 'not_due' }); continue; }
        const runId = randomUUID(), started = new Date().toISOString();
        await transaction(async r => {
          await fence(r, owner);
          await r.put('jobFeedStates', { ...state, id: source.id, failures: state?.failures || 0,
            status: 'running', lastAttemptAt: started, nextRunAt: Date.now() + source.intervalMinutes * 60000 });
        });
        try {
          const batch = await discover(source);
          const counts = await ingest(source, batch, owner, runId);
          await transaction(async r => {
            await fence(r, owner);
            await r.put('jobFeedStates', { id: source.id, status: counts.complete ? 'completed' : 'partial', failures: 0,
              nextRunAt: Date.now() + source.intervalMinutes * 60000, lastAttemptAt: started, lastSuccessAt: new Date().toISOString(), counts });
            await r.put('jobFeedRuns', { id: runId, sourceId: source.id, status: 'completed', startedAt: started, finishedAt: new Date().toISOString(), counts,
              expiresAtDate: new Date(Date.now() + 30 * 86400000) });
            if (counts.added || counts.updated || counts.closed) await refreshFeed(r);
          });
          results.push({ source: source.id, status: counts.complete ? 'completed' : 'partial', counts });
        } catch (e) {
          const errorCode = e instanceof FeedError ? e.code : 'SOURCE_UNAVAILABLE';
          if (errorCode === 'HTTP_429') providerBlocks.set(source.type, Date.now() + Math.max(3600000, e instanceof FeedError ? e.retryAfterMs : 0));
          const failures = (state?.failures || 0) + 1;
          await transaction(async r => {
            await fence(r, owner);
            if (errorCode === 'HTTP_429') await r.put('jobEngineState', { id: `provider-${source.type}`,
              until: Date.now() + Math.max(3600000, e instanceof FeedError ? e.retryAfterMs : 0) });
            await r.put('jobFeedStates', { ...state, id: source.id, status: 'failed', failures, errorCode,
              lastAttemptAt: started, nextRunAt: Date.now() + Math.max(source.intervalMinutes * 60000, Math.min(86400000, 60000 * 2 ** Math.min(failures, 10)), e instanceof FeedError ? e.retryAfterMs : 0) });
            await r.put('jobFeedRuns', { id: runId, sourceId: source.id, status: 'failed', errorCode, startedAt: started,
              finishedAt: new Date().toISOString(), expiresAtDate: new Date(Date.now() + 30 * 86400000) });
          });
          results.push({ source: source.id, status: 'failed', errorCode });
        }
      }
      cursor = sources[sources.length - 1].id;
    }
    const expired = await expireJobs();
    if (expired) await transaction(refreshFeed);
    return { status: 'completed', results, expired };
  } finally {
    await transaction(async r => {
      const lease = await r.get<Lease>('jobEngineState', leaseId);
      if (lease?.owner === owner) await r.put('jobEngineState', { ...lease, until: 0 });
    });
  }
}
export async function engineStatus() {
  return read(async r => ({
    sources: await r.find('jobFeedSources', {}, 1000), states: await r.find('jobFeedStates', {}, 1000),
    lease: await r.get('jobEngineState', leaseId),
    coverage: await r.get('jobEngineState', 'coverage-latest'),
    providerBackoffs: await r.find('jobEngineState', { id: { $regex: '^provider-' } }, 100),
    joobleBudgets: await r.find('jobEngineState', { id: { $regex: '^jooble-budget-' } }, 100),
    published: await r.count('jobs', { status: 'published' }),
  }));
}
