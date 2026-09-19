import { z } from 'zod';
import { read, transaction, type Repository } from './store.js';
import type { Job, User } from './domain.js';
import { ApiError, audit } from './security.js';

export const jobLifecycleStates = ['publishing', 'active', 'expired', 'closed', 'removed', 'reposted'] as const;
export type JobLifecycleState = typeof jobLifecycleStates[number];
export type JobFreshness = 'fresh' | 'aging' | 'stale';
export type JobLifecycle = { schemaVersion: 1; state: JobLifecycleState; revision: number; changedAt: string; reasonCode: string; declaredExpiresAt?: string; effectiveExpiresAt?: string };
export type LifecycleJob = Job & { lifecycle?: JobLifecycle; canonicalIdentityId?: string; repostOf?: string; repostedBy?: string };

export const lifecyclePolicySchema = z.object({
  version: z.string().regex(/^[a-zA-Z0-9._-]{1,60}$/).default('job-lifecycle-v1'),
  activeDays: z.number().int().min(1).max(90).default(90),
  agingAfterDays: z.number().int().min(1).max(89).default(60),
  batchSize: z.number().int().min(10).max(500).default(250),
}).strict().superRefine((value, ctx) => {
  if (value.agingAfterDays >= value.activeDays) ctx.addIssue({ code: 'custom', path: ['agingAfterDays'], message: 'Aging threshold must be before expiry.' });
});
export type LifecyclePolicy = z.infer<typeof lifecyclePolicySchema>;
export const defaultLifecyclePolicy = () => lifecyclePolicySchema.parse({});

const transitions: Record<JobLifecycleState, JobLifecycleState[]> = {
  publishing: ['active', 'closed', 'removed', 'reposted'],
  active: ['publishing', 'expired', 'closed', 'removed', 'reposted'],
  expired: ['reposted', 'removed'],
  closed: ['reposted', 'removed'],
  removed: [],
  reposted: ['removed'],
};

async function policy(r: Repository) {
  const row = await r.get<{ value: unknown; revision: number }>('systemConfig', 'job-lifecycle-policy');
  try { return { value: lifecyclePolicySchema.parse(row?.value ?? {}), revision: row?.revision ?? 0 }; }
  catch { throw new ApiError(503, 'LIFECYCLE_POLICY_INVALID', 'Job lifecycle configuration requires administrator review.'); }
}

export function lifecycleState(job: LifecycleJob, now = new Date()): JobLifecycleState {
  if (job.lifecycle?.state) return job.lifecycle.state;
  if (job.repostedBy) return 'reposted';
  if (job.status === 'disabled') return 'removed';
  if (job.status === 'closed') return Date.parse(job.expiresAt) <= now.getTime() ? 'expired' : 'closed';
  if (job.status === 'published') return Date.parse(job.expiresAt) <= now.getTime() ? 'expired' : 'active';
  return 'publishing';
}

export function effectiveExpiry(job: Pick<Job, 'discoveredAt' | 'expiresAt'>, activeDays = 90) {
  return new Date(Math.min(Date.parse(job.expiresAt), Date.parse(job.discoveredAt) + activeDays * 86400000));
}

export function expectedJobExpiry(job: Job) {
  const publishedAt = Date.parse(job.sourcePostedAt || job.discoveredAt);
  if (!Number.isFinite(publishedAt)) return job.expiresAt;
  const sourceClose = Date.parse(job.sourceExpiresAt || '');
  return new Date(Math.min(publishedAt + 90 * 86400000, Number.isFinite(sourceClose) ? sourceClose : Infinity)).toISOString();
}

export function jobFreshness(job: LifecycleJob, config: LifecyclePolicy = defaultLifecyclePolicy(), now = new Date()): JobFreshness {
  if (lifecycleState(job, now) !== 'active' || effectiveExpiry(job, config.activeDays).getTime() <= now.getTime()) return 'stale';
  return now.getTime() - Date.parse(job.discoveredAt) >= config.agingAfterDays * 86400000 ? 'aging' : 'fresh';
}

export function isLifecycleActive(job: LifecycleJob, activeDays = 90, now = new Date()) {
  return lifecycleState(job, now) === 'active' && Date.parse(job.discoveredAt) <= now.getTime() && effectiveExpiry(job, activeDays).getTime() > now.getTime();
}

const compatibleStatus = (state: JobLifecycleState): Job['status'] => state === 'active' ? 'published' : state === 'removed' ? 'disabled' : ['expired', 'closed', 'reposted'].includes(state) ? 'closed' : 'review';

export async function transitionJobLifecycle(r: Repository, jobId: string, target: JobLifecycleState, actorId: string, reasonCode: string, options: { expectedRevision?: number; now?: Date; relatedJobId?: string } = {}) {
  const now = options.now ?? new Date(), config = (await policy(r)).value;
  const job = await r.get<LifecycleJob>('jobs', jobId);
  if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.');
  const currentState = lifecycleState(job, now), revision = job.lifecycle?.revision ?? 0;
  if (options.expectedRevision !== undefined && options.expectedRevision !== revision) throw new ApiError(409, 'LIFECYCLE_REVISION_CONFLICT', 'Reload the job before changing its lifecycle.');
  if (currentState === target && job.lifecycle) return job;
  if (currentState !== target && !transitions[currentState].includes(target)) throw new ApiError(409, 'INVALID_LIFECYCLE_TRANSITION', `A job cannot move from ${currentState} to ${target}.`);
  if (target === 'active') {
    if (job.trust !== 'verified') throw new ApiError(409, 'JOB_VERIFICATION_REQUIRED', 'Job verification is required before publishing.');
    if (Date.parse(job.discoveredAt) > now.getTime() || effectiveExpiry(job, config.activeDays).getTime() <= now.getTime()) throw new ApiError(409, 'JOB_NOT_FRESH', 'Only a current job can be published.');
  }
  const declaredExpiresAt = job.lifecycle?.declaredExpiresAt || job.expiresAt;
  const effectiveExpiresAt = effectiveExpiry({ discoveredAt: job.discoveredAt, expiresAt: declaredExpiresAt }, config.activeDays).toISOString();
  const lifecycle: JobLifecycle = { schemaVersion: 1, state: target, revision: revision + 1, changedAt: now.toISOString(), reasonCode, declaredExpiresAt, effectiveExpiresAt };
  const next: LifecycleJob = { ...job, status: compatibleStatus(target), expiresAt: target === 'active' ? effectiveExpiresAt : job.expiresAt, lifecycle, ...(target === 'reposted' && options.relatedJobId ? { repostedBy: options.relatedJobId } : {}) };
  await r.put('jobs', next);
  await r.put('jobLifecycleEvents', { id: `${jobId}:${lifecycle.revision}`, schemaVersion: 1, jobId, from: currentState, to: target, revision: lifecycle.revision, reasonCode, actorId, ...(options.relatedJobId ? { relatedJobId: options.relatedJobId } : {}), changedAt: lifecycle.changedAt });
  await audit(r, actorId, `job.lifecycle.${target}`, jobId);
  return next;
}

export async function expireJobs(now = new Date()) {
  const config = await read(async r => (await policy(r)).value);
  let cursor = '', expired = 0;
  for (;;) {
    const batch = await read(r => r.scan<LifecycleJob>('jobs', { status: 'published' }, cursor, config.batchSize));
    if (!batch.length) return expired;
    expired += await transaction(async r => {
      let changed = 0;
      for (const item of batch) {
        let latest = await r.get<LifecycleJob>('jobs', item.id);
        if (!latest || latest.status !== 'published') continue;
        if (latest.feed) {
          const expected = expectedJobExpiry(latest);
          if (latest.expiresAt !== expected) {
            latest = { ...latest, expiresAt: expected };
            await r.put('jobs', latest);
          }
        }
        if (effectiveExpiry(latest, config.activeDays).getTime() <= now.getTime()) {
          const transitioned = await transitionJobLifecycle(r, latest.id, 'expired', 'job-lifecycle-worker', 'EXPIRY_REACHED', { now });
          if (transitioned.feed) await r.put('jobs', { ...transitioned, feed: { ...transitioned.feed, closedByEngine: true } });
          changed++;
        }
      }
      return changed;
    });
    cursor = batch.at(-1)!.id;
  }
}

export async function configureLifecyclePolicy(actor: User, input: unknown) {
  const data = z.object({ expectedRevision: z.number().int().min(0), policy: lifecyclePolicySchema }).strict().parse(input);
  return transaction(async r => {
    const current = await r.get<User>('users', actor.id), previous = await policy(r);
    if (!current || current.disabled || current.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
    if (previous.revision !== data.expectedRevision) throw new ApiError(409, 'LIFECYCLE_POLICY_CONFLICT', 'Reload lifecycle policy before saving.');
    await r.put('systemConfig', { id: 'job-lifecycle-policy', revision: previous.revision + 1, value: data.policy });
    await audit(r, actor.id, 'job.lifecycle_policy_updated', 'job-lifecycle-policy');
    return { policy: data.policy, revision: previous.revision + 1 };
  });
}

export async function lifecycleOverview(now = new Date()) {
  return read(async r => {
    const current = await policy(r), jobs = await r.scan<LifecycleJob>('jobs', {}, '', 500);
    const counts = Object.fromEntries(jobLifecycleStates.map(state => [state, jobs.filter(job => lifecycleState(job, now) === state).length]));
    const freshness = { fresh: 0, aging: 0, stale: 0 };
    for (const job of jobs) freshness[jobFreshness(job, current.value, now)]++;
    return { policy: current.value, revision: current.revision, counts, freshness, recentEvents: await r.find('jobLifecycleEvents', {}, 100) };
  });
}
