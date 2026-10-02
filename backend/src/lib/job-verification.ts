import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Job } from './domain.js';
import { assessJob, persistJobFraudAssessment } from './fraud-detection.js';
import type { Repository } from './store.js';
import { read, transaction } from './store.js';
import { ApiError, audit } from './security.js';

type FeedSource = { id: string; enabled?: boolean; approved?: boolean; publicListing?: boolean; publish?: boolean; intervalMinutes?: number };
type FeedState = { id: string; status?: string; failures?: number; lastSuccessAt?: string };
type FeedVariant = { id: string; jobId: string; sourceId: string; active?: boolean };
export type VerificationEvaluation = { eligible: boolean; reasonCodes: string[]; sourceId: string; sourceLastSuccessAt: string; contentHash: string };

const contentHash = (job: Job) => createHash('sha256').update(JSON.stringify({ title: job.title, company: job.company, description: job.description, requirements: job.requirements, method: job.method, url: job.url, email: job.email, expiresAt: job.expiresAt, sourcePostedAt: job.sourcePostedAt, feed: job.feed })).digest('hex');
const httpsUrl = (value?: string) => { try { const url = new URL(value || ''); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };

export async function evaluateJobVerification(r: Repository, job: Job, now = new Date()): Promise<VerificationEvaluation> {
  const reasons: string[] = [], sourceId = job.feed?.sourceId || '';
  const source = sourceId ? await r.get<FeedSource>('jobFeedSources', sourceId) : null;
  const state = sourceId ? await r.get<FeedState>('jobFeedStates', sourceId) : null;
  const variants = sourceId ? await r.find<FeedVariant>('jobFeedVariants', { jobId: job.id, sourceId, active: true }, 1) : [];
  const risk = await assessJob(r, job, now);
  if (job.sample) reasons.push('SAMPLE_JOB');
  if (job.status !== 'published') reasons.push('NOT_PUBLISHED');
  if (job.trust === 'flagged') reasons.push('TRUST_FLAGGED');
  if (Date.parse(job.expiresAt) <= now.getTime()) reasons.push('JOB_EXPIRED');
  if (!sourceId || !job.feed?.externalId || !job.feed.publicListing) reasons.push('PUBLIC_FEED_EVIDENCE_MISSING');
  if (!source) reasons.push('SOURCE_MISSING');
  else {
    if (!source.enabled) reasons.push('SOURCE_DISABLED');
    if (!source.approved) reasons.push('SOURCE_UNAPPROVED');
    if (!source.publicListing || !source.publish) reasons.push('SOURCE_NOT_PUBLIC');
  }
  if (!state || !['completed', 'partial'].includes(state.status || '') || (state.failures || 0) > 0 || !state.lastSuccessAt) reasons.push('SOURCE_NOT_HEALTHY');
  else {
    const age = now.getTime() - Date.parse(state.lastSuccessAt);
    const maximumAge = Math.max(48 * 3600000, (source?.intervalMinutes || 1440) * 3 * 60000);
    if (!Number.isFinite(age) || age < -300000 || age > maximumAge) reasons.push('SOURCE_EVIDENCE_STALE');
  }
  if (!variants.length) reasons.push('ACTIVE_SOURCE_VARIANT_MISSING');
  if (!httpsUrl(job.feed?.attributionUrl) || (job.method === 'external' && !httpsUrl(job.url))) reasons.push('SECURE_DESTINATION_MISSING');
  if (!job.title.trim() || !job.company.trim() || job.description.trim().length < 20) reasons.push('JOB_CONTENT_INCOMPLETE');
  if (risk.riskLevel !== 'low' || !risk.automationAllowed) reasons.push('FRAUD_REVIEW_REQUIRED');
  return { eligible: reasons.length === 0, reasonCodes: [...new Set(reasons)].sort(), sourceId, sourceLastSuccessAt: state?.lastSuccessAt || '', contentHash: contentHash(job) };
}

export async function verifyJobs(actorId: string, input: unknown = {}, now = new Date()) {
  const data = z.object({ jobId: z.string().min(1).max(100).optional(), limit: z.number().int().min(1).max(100).default(25), dryRun: z.boolean().default(false) }).strict().parse(input);
  const jobs = await read(async r => data.jobId ? [await r.get<Job>('jobs', data.jobId)].filter((job): job is Job => !!job) : r.scan<Job>('jobs', { status: 'published', trust: 'pending', sample: { $ne: true }, expiresAt: { $gt: now.toISOString() } }, '', data.limit));
  if (data.jobId && !jobs.length) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.');
  const results: { jobId: string; decision: 'verified' | 'unchanged' | 'withheld'; reasonCodes: string[] }[] = [];
  for (const snapshot of jobs) {
    if (data.dryRun) {
      const evaluation = await read(r => evaluateJobVerification(r, snapshot, now));
      results.push({ jobId: snapshot.id, decision: evaluation.eligible ? 'verified' : 'withheld', reasonCodes: evaluation.reasonCodes });
      continue;
    }
    results.push(await transaction(async r => {
      const current = await r.get<Job>('jobs', snapshot.id);
      if (!current) return { jobId: snapshot.id, decision: 'unchanged' as const, reasonCodes: ['JOB_NOT_FOUND'] };
      if (current.trust === 'verified') return { jobId: current.id, decision: 'unchanged' as const, reasonCodes: [] };
      const evaluation = await evaluateJobVerification(r, current, now);
      await persistJobFraudAssessment(r, current, now);
      if (!evaluation.eligible) return { jobId: current.id, decision: 'withheld' as const, reasonCodes: evaluation.reasonCodes };
      const verification: NonNullable<Job['verification']> = { rulesVersion: 'job-trust-v1', decision: 'verified', reasonCodes: ['APPROVED_PUBLIC_FEED', 'ACTIVE_SOURCE_VARIANT', 'LOW_FRAUD_RISK', 'HEALTHY_SOURCE'], verifiedAt: now.toISOString(), sourceId: evaluation.sourceId, sourceLastSuccessAt: evaluation.sourceLastSuccessAt, contentHash: evaluation.contentHash };
      await r.put('jobs', { ...current, trust: 'verified', verification });
      await audit(r, actorId, 'job.verified', current.id);
      return { jobId: current.id, decision: 'verified' as const, reasonCodes: verification.reasonCodes };
    }));
  }
  return { dryRun: data.dryRun, assessed: results.length, verified: results.filter(result => result.decision === 'verified').length, withheld: results.filter(result => result.decision === 'withheld').length, unchanged: results.filter(result => result.decision === 'unchanged').length, results };
}
