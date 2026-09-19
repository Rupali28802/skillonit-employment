import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Job } from './domain.js';
import { configuredMatchingProviders, jobIndexText, MatchingProviderError } from './matching-providers.js';
import { fingerprint, retryDelay } from './pipeline.js';
import { persistJobFraudAssessment, type FraudAssessment } from './fraud-detection.js';
import { resolveCanonicalJob, type DeduplicationOutcome } from './job-deduplication.js';
import { lifecycleState, transitionJobLifecycle } from './lifecycle.js';
import { ApiError, audit } from './security.js';
import { resolveJobTaxonomy } from './student-catalog.js';
import { read, transaction, type Repository } from './store.js';
import { retentionExpiry } from './data-retention.js';

const clean = (value: string) => value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/);
const httpsUrl = z.string().url().refine(value => new URL(value).protocol === 'https:');
const variantSchema = z.object({
  id: z.string().min(1), sourceId: identifier, sourceJobId: z.string().min(1).max(500), fetchedAt: z.string().datetime(),
  status: z.enum(['needs_normalization', 'retry', 'index_pending', 'processing']),
  provenance: z.object({ provider: z.string().min(1).max(100), sourceUrl: httpsUrl, permittedMethod: z.string().min(1).max(100) }).strict(),
  normalized: z.object({
    id: z.string().min(1).max(250), title: z.string().min(1).max(300), url: httpsUrl,
    description: z.string().min(1).max(200000), city: z.string().max(200).optional(), company: z.string().max(300).optional(),
    domain: z.string().max(253).optional(), country: z.string().max(100).optional(), state: z.string().max(150).optional(),
    category: z.string().max(200).optional(), skills: z.array(z.string().max(100)).max(200).optional(),
    mode: z.enum(['Remote', 'Hybrid', 'On-site']).optional(), type: z.string().max(100).optional(),
    salaryMin: z.number().nonnegative().optional(), salaryMax: z.number().nonnegative().optional(), currency: z.string().max(10).optional(),
    experienceMin: z.number().nonnegative().max(80).optional(), experienceMax: z.number().nonnegative().max(80).optional(),
    requirements: z.string().max(100000).optional(), employerId: z.string().max(200).optional(), email: z.string().email().optional(),
    occupationId: z.string().max(100).optional(), locationId: z.string().max(100).optional(), expiresAt: z.string().datetime().optional(),
  }).passthrough(),
}).passthrough();

export type IngestionPolicy = { enabled: boolean; batchSize: number; maxAttempts: number; retryBaseMs: number; retentionDays: number };
export const defaultIngestionPolicy = (): IngestionPolicy => ({ enabled: true, batchSize: 25, maxAttempts: 3, retryBaseMs: 1000, retentionDays: 90 });
const policySchema = z.object({ enabled: z.boolean(), batchSize: z.number().int().min(1).max(100), maxAttempts: z.number().int().min(1).max(10), retryBaseMs: z.number().int().min(100).max(60000), retentionDays: z.number().int().min(1).max(90) }).strict();

type Variant = z.infer<typeof variantSchema> & { attempts?: number; retryAt?: string; leaseUntil?: string; jobId?: string };
type IngestionResult = { variantId: string; jobId?: string; status: 'stored' | 'deduplicated' | 'quarantined' | 'retry' | 'failed'; code?: string };
export interface JobIndexSink { index(job: Job): Promise<'indexed' | 'not_eligible' | 'local'> }

export class ExistingMatchingIndexSink implements JobIndexSink {
  async index(job: Job) {
    if (job.status !== 'published' || job.trust !== 'verified') return 'not_eligible' as const;
    const providers = configuredMatchingProviders();
    if (!providers.search) return 'local' as const; // MongoDB is the existing local search index.
    const search = providers.search;
    await search.ensureIndex();
    const vector = providers.embeddings ? await providers.embeddings.embed(jobIndexText(job)) : undefined;
    await search.index(job, vector);
    return 'indexed' as const;
  }
}

async function event(r: Repository, variant: Variant, stage: string, status: string, correlationId: string, code?: string) {
  await r.put('jobIngestionEvents', { id: randomUUID(), sourceId: variant.sourceId, variantId: variant.id, stage, status, correlationId, ...(code ? { code } : {}), createdAt: new Date().toISOString(), expiresAtDate: retentionExpiry('operational') });
}

function canonicalJob(variant: Variant, sourceName: string, now: Date): Job & Record<string, unknown> {
  const n = variant.normalized;
  const discovered = new Date(n.discoveredAt as string || variant.fetchedAt);
  const expiry = n.expiresAt ? new Date(n.expiresAt) : new Date(discovered.getTime() + 90 * 86400000);
  const missing: string[] = [];
  const required = ['company', 'domain', 'country', 'category', 'mode', 'type', 'currency', 'employerId'] as const;
  for (const key of required) if (!n[key]) missing.push(key);
  if (!n.skills?.length) missing.push('skills');
  return {
    id: createHash('sha256').update(`${variant.sourceId}|${variant.sourceJobId}|${variant.fetchedAt}`).digest('hex').slice(0, 40),
    title: clean(n.title), company: clean(n.company || sourceName), domain: clean(n.domain || ''), country: clean(n.country || ''),
    state: clean(n.state || ''), city: clean(n.city || ''), category: clean(n.category || ''), skills: [...new Set((n.skills || []).map(clean).filter(Boolean))],
    mode: n.mode || 'On-site', type: clean(n.type || ''), salaryMin: n.salaryMin ?? 0, salaryMax: n.salaryMax ?? 0,
    currency: clean(n.currency || ''), experienceMin: n.experienceMin ?? 0, experienceMax: n.experienceMax ?? 0,
    description: clean(n.description), requirements: clean(n.requirements || ''), method: 'external', url: n.url,
    ...(n.email ? { email: n.email.toLowerCase() } : {}), status: 'review', trust: 'pending', employerId: clean(n.employerId || ''),
    source: variant.sourceId, discoveredAt: discovered.toISOString(), expiresAt: expiry.toISOString(),
    schemaVersion: 1, sourceVariantIds: [variant.id], provenance: [{ ...variant.provenance, sourceJobId: variant.sourceJobId, fetchedAt: variant.fetchedAt }],
    ingestion: { missingFields: missing, verifiedAt: null, indexedAt: null, requiresReview: true },
    lifecycle: { schemaVersion: 1, state: 'publishing', revision: 0, changedAt: now.toISOString(), reasonCode: 'INGESTED_FOR_REVIEW' },
  };
}

async function processVariant(variantInput: unknown, correlationId: string, sink: JobIndexSink, now = new Date()): Promise<IngestionResult> {
  let variant: Variant;
  try { variant = variantSchema.parse(variantInput) as Variant; }
  catch { return { variantId: (variantInput as { id?: string })?.id || 'unknown', status: 'quarantined', code: 'INGESTION_PARSE_INVALID' }; }
  const source = await read(r => r.get<any>('jobSources', variant.sourceId));
  if (!source?.enabled || source.compliance?.status !== 'approved') return { variantId: variant.id, status: 'quarantined', code: 'INGESTION_SOURCE_UNAPPROVED' };
  if (variant.status === 'index_pending' && variant.jobId) {
    const stored = await read(r => r.get<Job>('jobs', variant.jobId!));
    if (!stored) return { variantId: variant.id, status: 'quarantined', code: 'INGESTION_JOB_MISSING' };
    try {
      const indexed = await sink.index(stored);
      await transaction(async r => {
        await r.put('jobSourceVariants', { ...variant, status: 'stored', retryAt: undefined, leaseUntil: undefined, processedAt: now.toISOString() });
        await event(r, variant, 'index', indexed, correlationId);
      });
      return { variantId: variant.id, jobId: stored.id, status: 'stored' };
    } catch (error) {
      const code = error instanceof MatchingProviderError ? error.code : 'INGESTION_INDEX_FAILED';
      await transaction(async r => {
        await r.put('jobSourceVariants', { ...variant, status: 'index_pending', retryAt: new Date(now.getTime() + retryDelay(variant.attempts || 1)).toISOString(), leaseUntil: undefined });
        await event(r, variant, 'index', 'failed', correlationId, code);
      });
      return { variantId: variant.id, jobId: stored.id, status: 'retry', code };
    }
  }
  const job = canonicalJob(variant, clean(source.name || variant.sourceId), now);
  if (new Date(job.discoveredAt) > now || new Date(job.expiresAt) <= new Date(job.discoveredAt) || job.salaryMax < job.salaryMin || job.experienceMax < job.experienceMin)
    return { variantId: variant.id, status: 'quarantined', code: 'INGESTION_VALIDATION_FAILED' };
  let risk!: FraudAssessment;
  await transaction(async r => {
    risk = await persistJobFraudAssessment(r, job, now);
    if (risk.riskLevel === 'high' || risk.riskLevel === 'blocked') job.trust = 'flagged';
    await event(r, variant, 'fetch', 'succeeded', correlationId);
    await event(r, variant, 'parse', 'succeeded', correlationId);
    await event(r, variant, 'normalize', 'succeeded', correlationId);
    await event(r, variant, 'validate', 'succeeded', correlationId);
    await event(r, variant, 'verify', risk.riskLevel === 'high' || risk.riskLevel === 'blocked' ? 'flagged' : 'review_required', correlationId, risk.reasonCodes[0]);
    try {
      const taxonomy = await resolveJobTaxonomy(r, {
        ...(variant.normalized.occupationId || variant.normalized.category ? { occupation: variant.normalized.occupationId ? { id: variant.normalized.occupationId } : { label: variant.normalized.category } } : {}),
        ...(variant.normalized.locationId || variant.normalized.city ? { location: variant.normalized.locationId ? { id: variant.normalized.locationId } : { label: variant.normalized.city } } : {}),
      });
      job.matching = { ...(job.matching || {}), occupationId: taxonomy.occupationId || undefined, locationId: taxonomy.locationId || undefined } as Job['matching'];
      await event(r, variant, 'enrich', 'succeeded', correlationId);
    } catch (error) {
      (job.ingestion as any).taxonomyStatus = error instanceof ApiError ? error.code : 'TAXONOMY_UNRESOLVED';
      await event(r, variant, 'enrich', 'review_required', correlationId, (job.ingestion as any).taxonomyStatus);
    }
  });
  let deduplication!: DeduplicationOutcome;
  await transaction(async r => {
    deduplication = await resolveCanonicalJob(r, job, { variantId: variant.id, sourceId: variant.sourceId, sourceJobId: variant.sourceJobId, fetchedAt: variant.fetchedAt, provenance: variant.provenance }, now);
    const canonical = await r.get<Job>('jobs', deduplication.canonicalJobId);
    if (!canonical) throw new ApiError(503, 'CANONICAL_JOB_MISSING', 'Canonical job persistence failed.');
    if (job.id !== canonical.id) await r.remove('jobRiskAssessments', job.id);
    if (risk.riskLevel === 'high' || risk.riskLevel === 'blocked') {
      const transitioned = lifecycleState(canonical) === 'active' ? await transitionJobLifecycle(r, canonical.id, 'publishing', 'job-ingestion-worker', 'FRAUD_REVIEW_REQUIRED', { now }) : canonical;
      await r.put('jobs', { ...transitioned, trust: 'flagged', status: 'review' });
      await r.put('jobRiskAssessments', { ...risk, id: canonical.id, entityId: canonical.id });
    }
    await r.put('jobFingerprints', { id: fingerprint(canonical), jobId: canonical.id, canonicalIdentityId: deduplication.identityId, updatedAt: now.toISOString() });
    await r.put('jobSourceVariants', { ...variant, status: 'stored', jobId: canonical.id, deduplicated: deduplication.kind === 'duplicate', repost: deduplication.kind === 'repost', processedAt: now.toISOString(), leaseUntil: undefined });
    await event(r, variant, 'deduplicate', deduplication.kind === 'duplicate' ? 'collapsed' : deduplication.kind, correlationId, deduplication.reasonCode);
    await event(r, variant, 'store', 'succeeded', correlationId);
    await audit(r, 'job-ingestion-worker', `job.${deduplication.kind}`, canonical.id);
  });
  if (deduplication.kind === 'duplicate') return { variantId: variant.id, jobId: deduplication.canonicalJobId, status: 'deduplicated' };
  const storedJob = await read(r => r.get<Job>('jobs', deduplication.canonicalJobId));
  if (!storedJob) throw new ApiError(503, 'CANONICAL_JOB_MISSING', 'Canonical job persistence failed.');
  try {
    const indexed = await sink.index(storedJob);
    await transaction(async r => event(r, variant, 'index', indexed, correlationId));
  } catch (error) {
    const code = error instanceof MatchingProviderError ? error.code : 'INGESTION_INDEX_FAILED';
    await transaction(async r => {
      await r.put('jobSourceVariants', { ...variant, status: 'index_pending', jobId: storedJob.id, retryAt: new Date(now.getTime() + retryDelay((variant.attempts || 0) + 1)).toISOString(), processedAt: now.toISOString() });
      await event(r, variant, 'index', 'failed', correlationId, code);
    });
    return { variantId: variant.id, jobId: storedJob.id, status: 'retry', code };
  }
  return { variantId: variant.id, jobId: storedJob.id, status: 'stored' };
}

export async function configureIngestionPolicy(actorId: string, input: unknown) {
  const value = policySchema.parse(input);
  await transaction(async r => { await r.put('systemConfig', { id: 'job-ingestion-policy', schemaVersion: 1, value, updatedAt: new Date().toISOString() }); await audit(r, actorId, 'ingestion.policy_updated', 'job-ingestion-policy'); });
  return value;
}
export async function ingestionOverview() {
  return read(async r => ({ policy: (await r.get<{ value: IngestionPolicy }>('systemConfig', 'job-ingestion-policy'))?.value || defaultIngestionPolicy(), queued: await r.count('jobSourceVariants', { status: 'needs_normalization' }), retrying: await r.count('jobSourceVariants', { status: 'index_pending' }), quarantined: await r.count('jobSourceVariants', { status: 'quarantined' }), recentRuns: await r.find('jobIngestionRuns', {}, 25) }));
}
export async function runIngestion(actorId = 'job-ingestion-worker', sink: JobIndexSink = new ExistingMatchingIndexSink(), now = new Date()) {
  const policy = await read(async r => (await r.get<{ value: IngestionPolicy }>('systemConfig', 'job-ingestion-policy'))?.value || defaultIngestionPolicy());
  const run = { id: randomUUID(), actorId, status: policy.enabled ? 'RUNNING' : 'PAUSED', startedAt: now.toISOString(), processed: 0, failed: 0 };
  await transaction(r => r.put('jobIngestionRuns', run));
  if (!policy.enabled) return run;
  const all = await read(async r => [...await r.find<Variant>('jobSourceVariants', { status: 'needs_normalization' }, policy.batchSize), ...await r.find<Variant>('jobSourceVariants', { status: 'index_pending' }, policy.batchSize)]);
  const variants = all.filter((v, index) => all.findIndex(x => x.id === v.id) === index).filter(v => !v.retryAt || v.retryAt <= now.toISOString()).slice(0, policy.batchSize);
  const results: IngestionResult[] = [];
  for (const item of variants) {
    const attempts = (item.attempts || 0) + 1;
    await transaction(r => r.put('jobSourceVariants', { ...item, status: 'processing', attempts, leaseUntil: new Date(now.getTime() + 60000).toISOString() }));
    let result = await processVariant({ ...item, status: item.status, attempts }, run.id, sink, now);
    if (result.status === 'retry' && attempts >= policy.maxAttempts) {
      result = { ...result, status: 'failed', code: 'INGESTION_RETRY_EXHAUSTED' };
      await transaction(async r => {
        await r.put('jobSourceVariants', { ...item, status: 'failed', attempts, jobId: result.jobId, errorCode: result.code, processedAt: now.toISOString(), leaseUntil: undefined });
        await event(r, item, 'pipeline', 'failed', run.id, result.code);
      });
    }
    results.push(result);
    if (result.status === 'quarantined') await transaction(async r => { await r.put('jobSourceVariants', { ...item, status: 'quarantined', attempts, errorCode: result.code, processedAt: now.toISOString(), leaseUntil: undefined }); await event(r, item, 'pipeline', 'quarantined', run.id, result.code); });
  }
  const finished = { ...run, status: results.some(x => ['retry', 'quarantined', 'failed'].includes(x.status)) ? 'DEGRADED' : 'COMPLETED', processed: results.length, failed: results.filter(x => ['retry', 'quarantined', 'failed'].includes(x.status)).length, finishedAt: new Date().toISOString(), results };
  await transaction(r => r.put('jobIngestionRuns', finished));
  return finished;
}
