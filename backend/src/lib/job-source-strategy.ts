import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { read, transaction, type Repository } from './store.js';
import { ApiError, audit, rateLimit } from './security.js';
import type { Job } from './domain.js';
import { assessSource } from './fraud-detection.js';
import { retentionExpiry } from './data-retention.js';

const isoDate = z.string().datetime({ offset: true });
const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/i);

const sourceFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  // SmartRecruiters is handled by the main job-engine source pipeline. Keep
  // this direct ATS registry limited to providers for which it has an adapter.
  provider: z.enum(['greenhouse', 'lever', 'ashby']),
  configuration: z.object({ board: slug }),
  enabled: z.boolean().default(false),
  compliance: z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'suspended']),
    policyEvidence: z.string().trim().min(20).max(2000),
    permittedMethod: z.literal('official_api'),
    jurisdictions: z.array(z.string().trim().min(2).max(80)).max(250).default([]),
  }),
  schedule: z.object({ intervalMinutes: z.number().int().min(5).max(10080) }),
  rate: z.object({ requestsPerMinute: z.number().int().min(1).max(10) }),
  retry: z.object({
    maxAttempts: z.number().int().min(1).max(10).default(3),
    baseDelaySeconds: z.number().int().min(1).max(3600).default(30),
    maxDelaySeconds: z.number().int().min(1).max(86400).default(3600),
  }).refine(value => value.maxDelaySeconds >= value.baseDelaySeconds),
});
const requireApprovalWhenEnabled = (value: { enabled?: boolean; compliance?: { status?: string } }, context: z.RefinementCtx) => {
  if (value.enabled && value.compliance?.status !== 'approved')
    context.addIssue({ code: 'custom', path: ['enabled'], message: 'Only an approved source can be enabled.' });
};
export const sourceCreateSchema = sourceFieldsSchema.superRefine(requireApprovalWhenEnabled);

export const sourceUpdateSchema = sourceFieldsSchema.omit({ provider: true }).partial().extend({
  revision: z.number().int().positive(),
});

export type SourceFailureClassification =
  | 'configuration' | 'authorization' | 'rate_limit' | 'transient'
  | 'provider_contract' | 'permanent';
export type SourceStatus = 'disabled' | 'idle' | 'running' | 'degraded' | 'failed';
export type JobSource = z.infer<typeof sourceCreateSchema> & {
  id: string;
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
  reviewedBy: string;
  reviewedAt: string;
  nextRunAt: string;
  lastRunAt?: string;
  leaseUntil?: string;
  health: {
    status: SourceStatus;
    consecutiveFailures: number;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastErrorCode?: string;
    lastClassification?: SourceFailureClassification;
  };
};
type LegacySource = {
  id: string; type: 'greenhouse'; board: string; name: string; enabled: boolean;
  approved: boolean; requestsPerMinute: number; policyEvidence: string;
  reviewedBy?: string; reviewedAt?: string;
};

function hydrateSource(value: unknown): JobSource | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.schemaVersion === 1) return row as JobSource;
  const legacy = value as LegacySource;
  if (legacy.type !== 'greenhouse' || !slug.safeParse(legacy.board).success) return null;
  const reviewedAt = typeof legacy.reviewedAt === 'string' ? legacy.reviewedAt : new Date(0).toISOString();
  const input = sourceCreateSchema.safeParse({
    name: legacy.name, provider: 'greenhouse', configuration: { board: legacy.board },
    enabled: legacy.enabled && legacy.approved,
    compliance: {
      status: legacy.approved ? 'approved' : 'pending', policyEvidence: legacy.policyEvidence,
      permittedMethod: 'official_api', jurisdictions: [],
    },
    schedule: { intervalMinutes: 60 }, rate: { requestsPerMinute: legacy.requestsPerMinute },
    retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 3600 },
  });
  if (!input.success) return null;
  return {
    id: legacy.id, schemaVersion: 1, revision: 1, ...input.data,
    createdAt: reviewedAt, updatedAt: reviewedAt,
    reviewedBy: legacy.reviewedBy || 'legacy-migration', reviewedAt,
    nextRunAt: reviewedAt,
    health: { status: input.data.enabled ? 'idle' : 'disabled', consecutiveFailures: 0 },
  };
}

export type SourceRecord = {
  externalId: string;
  title: string;
  url: string;
  description: string;
  location: string;
  updatedAt?: string;
};

async function assertUniqueSourceIdentity(r: Repository, provider: JobSource['provider'], board: string, exceptId?: string) {
  const normalizedBoard = board.toLocaleLowerCase('en-US');
  const existing = (await r.find('jobSources', {}, 1000)).map(hydrateSource).find(source =>
    source && source.id !== exceptId && source.provider === provider
      && source.configuration.board.toLocaleLowerCase('en-US') === normalizedBoard,
  );
  if (existing)
    throw new ApiError(409, 'SOURCE_ALREADY_REGISTERED', 'This official provider board is already registered. Review the existing source instead.');
}
export type SourceFetchResult = { records: SourceRecord[]; fetchedAt: string; cursor?: string };
export interface JobSourceAdapter {
  readonly provider: JobSource['provider'];
  fetch(source: JobSource, signal: AbortSignal): Promise<SourceFetchResult>;
}

export class SourceProviderError extends Error {
  constructor(
    readonly code: string,
    readonly classification: SourceFailureClassification,
    readonly retryable: boolean,
  ) { super(code); }
}

type HttpFetch = typeof fetch;
export class GreenhouseSourceAdapter implements JobSourceAdapter {
  readonly provider = 'greenhouse' as const;
  constructor(private readonly transport: HttpFetch = fetch) {}
  async fetch(source: JobSource, signal: AbortSignal): Promise<SourceFetchResult> {
    const board = source.configuration.board;
    if (!slug.safeParse(board).success)
      throw new SourceProviderError('SOURCE_CONFIGURATION_INVALID', 'configuration', false);
    let response: Response;
    try {
      response = await this.transport(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
        { signal, headers: { Accept: 'application/json' } },
      );
    } catch {
      throw new SourceProviderError('SOURCE_NETWORK_ERROR', 'transient', true);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new SourceProviderError('SOURCE_AUTHORIZATION_FAILED', 'authorization', false);
      if (response.status === 429)
        throw new SourceProviderError('SOURCE_RATE_LIMITED', 'rate_limit', true);
      if (response.status >= 500)
        throw new SourceProviderError('SOURCE_PROVIDER_UNAVAILABLE', 'transient', true);
      throw new SourceProviderError('SOURCE_REQUEST_REJECTED', 'permanent', false);
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new SourceProviderError('SOURCE_RESPONSE_INVALID', 'provider_contract', false); }
    const parsed = z.object({ jobs: z.array(z.object({
      id: z.union([z.string(), z.number()]),
      title: z.string().min(1).max(500),
      absolute_url: z.string().url().refine(value => value.startsWith('https://')),
      content: z.string().default(''),
      location: z.object({ name: z.string().default('') }).default({ name: '' }),
      updated_at: z.string().optional(),
    })).max(5000) }).safeParse(payload);
    if (!parsed.success)
      throw new SourceProviderError('SOURCE_RESPONSE_INVALID', 'provider_contract', false);
    return {
      fetchedAt: new Date().toISOString(),
      records: parsed.data.jobs.slice(0, 1000).map(job => ({
        externalId: String(job.id), title: job.title, url: job.absolute_url,
        description: job.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 15000),
        location: job.location.name.slice(0, 300), updatedAt: job.updated_at,
      })),
    };
  }
}

const sourceResponseError = (response: Response): SourceProviderError => {
  if (response.status === 401 || response.status === 403)
    return new SourceProviderError('SOURCE_AUTHORIZATION_FAILED', 'authorization', false);
  if (response.status === 429)
    return new SourceProviderError('SOURCE_RATE_LIMITED', 'rate_limit', true);
  if (response.status >= 500)
    return new SourceProviderError('SOURCE_PROVIDER_UNAVAILABLE', 'transient', true);
  return new SourceProviderError('SOURCE_REQUEST_REJECTED', 'permanent', false);
};

const cleanDescription = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 15000);
const explicitLocation = (value: string) => {
  const location = value.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!/\bindia\b/i.test(location)) return { city: location };
  const city = location.replace(/\bindia\b/ig, '').replace(/^[,\-–—\s]+|[,\-–—\s]+$/g, '').trim();
  return { city, country: 'India' };
};
const providerTimestamp = (value: string | undefined) => value && isoDate.safeParse(value).success ? value : undefined;

export class LeverSourceAdapter implements JobSourceAdapter {
  readonly provider = 'lever' as const;
  constructor(private readonly transport: HttpFetch = fetch) {}
  async fetch(source: JobSource, signal: AbortSignal): Promise<SourceFetchResult> {
    try {
      const response = await this.transport(
        `https://api.lever.co/v0/postings/${encodeURIComponent(source.configuration.board)}?mode=json&limit=100`,
        { signal, headers: { Accept: 'application/json' } },
      );
      if (!response.ok) throw sourceResponseError(response);
      const payload: unknown = await response.json().catch(() => { throw new SourceProviderError('SOURCE_RESPONSE_INVALID', 'provider_contract', false); });
      const parsed = z.array(z.object({
        id: z.string().min(1).max(300), text: z.string().min(1).max(500),
        hostedUrl: z.string().url().refine(value => value.startsWith('https://')),
        descriptionPlain: z.string().optional(), additionalPlain: z.string().optional(),
        categories: z.object({ location: z.string().optional() }).optional(),
      })).max(1000).safeParse(payload);
      if (!parsed.success) throw new SourceProviderError('SOURCE_RESPONSE_INVALID', 'provider_contract', false);
      return { fetchedAt: new Date().toISOString(), records: parsed.data.map(job => ({
        externalId: job.id, title: job.text, url: job.hostedUrl,
        description: cleanDescription([job.descriptionPlain, job.additionalPlain].filter(Boolean).join('\n')),
        location: job.categories?.location?.slice(0, 300) || '',
      })) };
    } catch (error) {
      if (error instanceof SourceProviderError) throw error;
      throw new SourceProviderError('SOURCE_NETWORK_ERROR', 'transient', true);
    }
  }
}

export class AshbySourceAdapter implements JobSourceAdapter {
  readonly provider = 'ashby' as const;
  constructor(private readonly transport: HttpFetch = fetch) {}
  async fetch(source: JobSource, signal: AbortSignal): Promise<SourceFetchResult> {
    try {
      const response = await this.transport(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.configuration.board)}`,
        { signal, headers: { Accept: 'application/json' } },
      );
      if (!response.ok) throw sourceResponseError(response);
      const payload: unknown = await response.json().catch(() => { throw new SourceProviderError('SOURCE_RESPONSE_INVALID', 'provider_contract', false); });
      const parsed = z.object({ jobs: z.array(z.object({
        id: z.string().min(1).max(300), title: z.string().min(1).max(500),
        jobUrl: z.string().url().refine(value => value.startsWith('https://')),
        descriptionPlain: z.string().optional(), descriptionHtml: z.string().optional(), location: z.string().optional(),
        isListed: z.boolean().optional(), publishedAt: z.string().optional(),
      })).max(1000) }).safeParse(payload);
      if (!parsed.success) throw new SourceProviderError('SOURCE_RESPONSE_INVALID', 'provider_contract', false);
      return { fetchedAt: new Date().toISOString(), records: parsed.data.jobs.filter(job => job.isListed !== false).map(job => ({
        externalId: job.id, title: job.title, url: job.jobUrl,
        description: cleanDescription(job.descriptionPlain || job.descriptionHtml || ''),
        location: job.location?.slice(0, 300) || '', updatedAt: job.publishedAt,
      })) };
    } catch (error) {
      if (error instanceof SourceProviderError) throw error;
      throw new SourceProviderError('SOURCE_NETWORK_ERROR', 'transient', true);
    }
  }
}

export class SourceAdapterRegistry {
  private readonly adapters = new Map<JobSource['provider'], JobSourceAdapter>();
  constructor(adapters: JobSourceAdapter[] = [new GreenhouseSourceAdapter(), new LeverSourceAdapter(), new AshbySourceAdapter()]) {
    for (const adapter of adapters) this.adapters.set(adapter.provider, adapter);
  }
  get(provider: JobSource['provider']) {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new SourceProviderError('SOURCE_PROVIDER_NOT_CONFIGURED', 'configuration', false);
    return adapter;
  }
}

const runtime = () => {
  const timeoutMs = z.coerce.number().int().min(1000).max(30000)
    .parse(process.env.JOB_SOURCE_PROVIDER_TIMEOUT_MS || 10000);
  const batchSize = z.coerce.number().int().min(1).max(100)
    .parse(process.env.JOB_SOURCE_SCHEDULER_BATCH_SIZE || 20);
  return { timeoutMs, batchSize };
};
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60000).toISOString();
const retryAt = (source: JobSource, now: Date) => {
  const attempt = Math.max(1, source.health.consecutiveFailures + 1);
  const seconds = Math.min(source.retry.maxDelaySeconds, source.retry.baseDelaySeconds * 2 ** (attempt - 1));
  return new Date(now.getTime() + seconds * 1000).toISOString();
};
const event = async (r: Repository, input: {
  sourceId: string; stage: string; status: 'started' | 'succeeded' | 'failed';
  correlationId: string; actorId: string; count?: number; code?: string;
  classification?: SourceFailureClassification; retryable?: boolean;
}) => r.put('jobIngestionEvents', { id: randomUUID(), schemaVersion: 1, ...input, createdAt: new Date().toISOString(), expiresAtDate: retentionExpiry('operational') });

export async function createJobSource(actorId: string, input: unknown, now = new Date()) {
  const value = sourceCreateSchema.parse(input);
  const stamp = now.toISOString();
  const row: JobSource = {
    id: randomUUID(), schemaVersion: 1, revision: 1, ...value,
    createdAt: stamp, updatedAt: stamp, reviewedBy: actorId, reviewedAt: stamp,
    nextRunAt: value.enabled ? stamp : addMinutes(now, value.schedule.intervalMinutes),
    health: { status: value.enabled ? 'idle' : 'disabled', consecutiveFailures: 0 },
  };
  await transaction(async r => {
    await assertUniqueSourceIdentity(r, value.provider, value.configuration.board);
    await r.put('jobSources', row);
    await r.put('entityRiskAssessments', await assessSource(r, row, now));
    await audit(r, actorId, 'source.created', row.id);
  });
  return row;
}

export async function updateJobSource(actorId: string, sourceId: string, input: unknown, now = new Date()) {
  const patch = sourceUpdateSchema.parse(input);
  return transaction(async r => {
    const current = hydrateSource(await r.get('jobSources', sourceId));
    if (!current) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'Job source not found.');
    if (current.revision !== patch.revision)
      throw new ApiError(409, 'SOURCE_REVISION_CONFLICT', 'The source changed. Reload and try again.');
    const merged = sourceCreateSchema.parse({ ...current, ...patch });
    await assertUniqueSourceIdentity(r, merged.provider, merged.configuration.board, sourceId);
    const stamp = now.toISOString();
    const next: JobSource = {
      ...current, ...merged, revision: current.revision + 1, updatedAt: stamp,
      reviewedBy: actorId, reviewedAt: stamp,
      nextRunAt: merged.enabled ? (current.enabled ? current.nextRunAt : stamp) : addMinutes(now, merged.schedule.intervalMinutes),
      health: { ...current.health, status: merged.enabled ? (current.health.status === 'disabled' ? 'idle' : current.health.status) : 'disabled' },
    };
    await r.put('jobSources', next);
    await r.put('entityRiskAssessments', await assessSource(r, next, now));
    await audit(r, actorId, 'source.updated', sourceId);
    return next;
  });
}

export async function listJobSources() {
  return read(async r => (await r.find('jobSources', {}, 1000)).map(hydrateSource).filter((row): row is JobSource => !!row));
}
export async function sourceEvents(sourceId: string, limit = 100) {
  return read(r => r.find('jobIngestionEvents', { sourceId }, Math.min(250, Math.max(1, limit))));
}

function assertRunnable(source: JobSource) {
  if (!source.enabled) throw new SourceProviderError('SOURCE_DISABLED', 'configuration', false);
  if (source.compliance.status !== 'approved')
    throw new SourceProviderError('SOURCE_COMPLIANCE_REQUIRED', 'configuration', false);
}

export async function fetchJobSource(
  sourceId: string,
  correlationId: string,
  actorId = 'source-scheduler',
  registry = new SourceAdapterRegistry(),
  now = new Date(),
) {
  const source = await read(async r => hydrateSource(await r.get('jobSources', sourceId)));
  if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'Job source not found.');
  try { assertRunnable(source); }
  catch (error) {
    if (error instanceof SourceProviderError)
      throw new ApiError(409, error.code, 'This source is not approved and enabled.');
    throw error;
  }
  await rateLimit(`job-source:${source.id}`, source.rate.requestsPerMinute);
  await transaction(async r => {
    await r.put('jobSources', { ...source, health: { ...source.health, status: 'running' }, lastRunAt: now.toISOString() });
    await event(r, { sourceId, stage: 'fetch', status: 'started', correlationId, actorId });
  });
  try {
    const result = await registry.get(source.provider).fetch(source, AbortSignal.timeout(runtime().timeoutMs));
    await transaction(async r => {
      for (const record of result.records) {
        const id = createHash('sha256').update(`${source.id}|${record.externalId}`).digest('hex');
        await r.put('jobSourceVariants', {
          id, schemaVersion: 1, sourceId: source.id, sourceJobId: record.externalId,
          fetchedAt: result.fetchedAt, status: 'needs_normalization',
          provenance: { provider: source.provider, sourceUrl: record.url, permittedMethod: source.compliance.permittedMethod },
          normalized: {
            id: `${source.provider}-${source.configuration.board}-${record.externalId}`,
            title: record.title, url: record.url, description: record.description,
            ...explicitLocation(record.location), ...(providerTimestamp(record.updatedAt) ? { sourceUpdatedAt: providerTimestamp(record.updatedAt) } : {}),
            method: 'external', source: source.id,
            status: 'review', trust: 'pending', discoveredAt: result.fetchedAt,
          } satisfies Partial<Job>,
        });
      }
      const current = hydrateSource(await r.get('jobSources', sourceId)) ?? source;
      await r.put('jobSources', {
        ...current, leaseUntil: undefined, nextRunAt: addMinutes(now, source.schedule.intervalMinutes),
        health: { status: 'idle', consecutiveFailures: 0, lastSuccessAt: result.fetchedAt },
      });
      await event(r, { sourceId, stage: 'fetch', status: 'succeeded', correlationId, actorId, count: result.records.length });
      await audit(r, actorId, 'source.fetch_succeeded', sourceId);
    });
    return { sourceId, fetched: result.records.length, status: 'succeeded' as const };
  } catch (cause) {
    const failure = cause instanceof SourceProviderError
      ? cause : new SourceProviderError('SOURCE_FETCH_FAILED', 'transient', true);
    await transaction(async r => {
      const current = hydrateSource(await r.get('jobSources', sourceId)) ?? source;
      const failures = current.health.consecutiveFailures + 1;
      const exhausted = !failure.retryable || failures >= source.retry.maxAttempts;
      await r.put('jobSources', {
        ...current, leaseUntil: undefined,
        nextRunAt: exhausted ? addMinutes(now, source.schedule.intervalMinutes) : retryAt(current, now),
        health: {
          ...current.health, status: exhausted ? 'failed' : 'degraded', consecutiveFailures: failures,
          lastFailureAt: now.toISOString(), lastErrorCode: failure.code, lastClassification: failure.classification,
        },
      });
      await event(r, { sourceId, stage: 'fetch', status: 'failed', correlationId, actorId,
        code: failure.code, classification: failure.classification, retryable: failure.retryable && !exhausted });
      await audit(r, actorId, exhausted ? 'source.fetch_failed' : 'source.retry_scheduled', sourceId);
    });
    throw new ApiError(failure.retryable ? 503 : 422, failure.code,
      failure.retryable ? 'The source is temporarily unavailable. Retry later.' : 'The source configuration or provider response requires review.');
  }
}

export async function claimDueJobSources(now = new Date(), options: {
  limit?: number; jurisdiction?: string; sourceIds?: string[]; force?: boolean;
} = {}) {
  const { batchSize } = runtime();
  return transaction(async r => {
    const candidates = (await r.find('jobSources', { enabled: true }, 1000)).map(hydrateSource).filter((row): row is JobSource => !!row)
      .filter(source => source.compliance.status === 'approved' && source.health.status !== 'failed'
        && (options.force || source.nextRunAt <= now.toISOString())
        && (!options.sourceIds || options.sourceIds.includes(source.id))
        && (!options.jurisdiction || !source.compliance.jurisdictions.length
          || source.compliance.jurisdictions.includes('global')
          || source.compliance.jurisdictions.includes(options.jurisdiction))
        && (!source.leaseUntil || source.leaseUntil < now.toISOString()))
      .sort((a, b) => (a.lastRunAt || '').localeCompare(b.lastRunAt || '')
        || a.nextRunAt.localeCompare(b.nextRunAt) || a.id.localeCompare(b.id))
      .slice(0, Math.min(batchSize, options.limit ?? batchSize));
    const leaseUntil = new Date(now.getTime() + 60000).toISOString();
    for (const source of candidates) await r.put('jobSources', { ...source, leaseUntil });
    return candidates.map(source => source.id);
  });
}

export async function runDueJobSources(registry = new SourceAdapterRegistry(), now = new Date()) {
  const ids = await claimDueJobSources(now);
  const results = [];
  for (const sourceId of ids) {
    try { results.push(await fetchJobSource(sourceId, randomUUID(), 'source-scheduler', registry, now)); }
    catch { results.push({ sourceId, fetched: 0, status: 'failed' as const }); }
  }
  return results;
}
