import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { User } from './domain.js';
import type { Repository, Row } from './store.js';
import { read, transaction } from './store.js';
import { redisSettings, deadline } from './module2-redis.js';
import { ApiError, audit } from './security.js';
import { retentionExpiry } from './data-retention.js';

export const taskNames = ['cv-process', 'cv-maintenance', 'application-sender', 'auto-apply-scheduler', 'auto-apply-user', 'subscription-expiry', 'source-scheduler', 'source-discovery', 'source-fetch', 'job-ingestion', 'job-verify', 'fraud-recheck', 'job-retention', 'notification-dispatch', 'job-dedupe', 'analytics-rollup', 'data-retention'] as const;
export type QueueTaskName = typeof taskNames[number];
export type QueueTask = { id: string; name: QueueTaskName; data: unknown; attempt: number };
export type QueueHandler = (data: Record<string, string>, context: { taskId: string; attempt: number }) => Promise<unknown>;

const empty = z.object({}).strict();
const taskDataSchemas: Record<QueueTaskName, z.ZodType<Record<string, string>>> = {
  'cv-process': empty, 'cv-maintenance': empty, 'application-sender': empty, 'auto-apply-scheduler': empty,
  'auto-apply-user': z.object({ userId: z.string().min(1).max(100) }).strict(), 'subscription-expiry': empty,
  'source-scheduler': empty, 'source-discovery': z.object({ sourceId: z.string().min(1).max(100) }).strict(),
  'source-fetch': z.object({ sourceId: z.string().min(1).max(100) }).strict(), 'job-ingestion': empty,
  'job-verify': z.object({ jobId: z.string().min(1).max(100).optional() }).strict(),
  'fraud-recheck': z.object({ jobId: z.string().min(1).max(100).optional() }).strict(), 'job-retention': empty,
  'notification-dispatch': empty, 'job-dedupe': z.object({ jobId: z.string().min(1).max(100) }).strict(), 'analytics-rollup': empty, 'data-retention': empty,
};

export type TaskPolicy = { attempts: number; backoffMs: number; timeoutMs: number; concurrency: number };
export const taskPolicies: Record<QueueTaskName, TaskPolicy> = Object.fromEntries(taskNames.map(name => [name, {
  attempts: ['application-sender', 'notification-dispatch', 'job-ingestion'].includes(name) ? 5 : 3,
  backoffMs: ['application-sender', 'notification-dispatch'].includes(name) ? 30_000 : 2_000,
  timeoutMs: ['cv-process', 'cv-maintenance'].includes(name) ? 15 * 60_000 : 5 * 60_000,
  concurrency: 1,
}])) as Record<QueueTaskName, TaskPolicy>;

export type QueueSchedule = { id: string; name: QueueTaskName; every: number };
export function configuredSchedules(env = process.env): QueueSchedule[] {
  const schedules: QueueSchedule[] = [];
  const add = (enabled: boolean, name: QueueTaskName, every: number) => { if (enabled) schedules.push({ id: name, name, every }); };
  add(env.ENABLE_CV_UPLOADS === 'true', 'cv-process', 60_000); add(env.ENABLE_CV_UPLOADS === 'true', 'cv-maintenance', 3_600_000);
  add(env.ENABLE_APPLICATION_ENGINE === 'true', 'application-sender', 60_000); add(env.ENABLE_APPLICATION_ENGINE === 'true', 'auto-apply-scheduler', 300_000); add(env.ENABLE_APPLICATION_ENGINE === 'true', 'subscription-expiry', 3_600_000);
  add((env.ENABLE_JOB_DISCOVERY_ENGINE ?? env.ENABLE_JOB_SOURCE_STRATEGY) === 'true', 'source-scheduler', 60_000);
  add(env.ENABLE_JOB_INGESTION_PIPELINE === 'true', 'job-ingestion', 60_000); add(env.ENABLE_JOB_VERIFICATION === 'true', 'job-verify', 300_000); add(env.ENABLE_FRAUD_RECHECK === 'true', 'fraud-recheck', 3_600_000);
  add(env.ENABLE_JOB_LIFECYCLE === 'true', 'job-retention', 3_600_000); add(env.ENABLE_NOTIFICATION_PLATFORM === 'true', 'notification-dispatch', 60_000);
  add(env.ENABLE_ANALYTICS === 'true', 'analytics-rollup', Math.min(86_400_000, Math.max(300_000, Number(env.ANALYTICS_ROLLUP_INTERVAL_MS || 3_600_000) || 3_600_000)));
  // PostgreSQL needs the worker to replace MongoDB's background TTL monitor.
  add(env.ENABLE_RETENTION_MAINTENANCE !== 'false', 'data-retention', env.DATABASE_URL?.trim() ? 60_000 : 86_400_000);
  return schedules;
}

export function queueConnection(env = process.env) {
  if (!env.DATABASE_URL && !env.MONGODB_URI) throw new Error('QUEUE_DATABASE_REQUIRED');
  return redisSettings(env);
}

function failureCode(error: unknown) {
  if (error instanceof ApiError && /^[A-Z0-9_]{2,80}$/.test(error.code)) return error.code;
  return 'QUEUE_TASK_FAILED';
}
function reference(data: Record<string, string>) {
  return Object.fromEntries(['userId', 'sourceId', 'jobId'].filter(key => data[key]).map(key => [key, data[key]]));
}

export async function executeQueueTask(task: QueueTask, handler: QueueHandler, now = new Date()) {
  const name = z.enum(taskNames).parse(task.name), data = taskDataSchemas[name].parse(task.data), policy = taskPolicies[name];
  if (!Number.isInteger(task.attempt) || task.attempt < 1 || task.attempt > policy.attempts) throw new ApiError(400, 'QUEUE_ATTEMPT_INVALID', 'Queue attempt is invalid.');
  const executionId = `${name}:${task.id}`;
  const claimed = await transaction(async r => {
    const current = await r.get<Row>('queueExecutions', executionId);
    if (current?.status === 'completed') return false;
    if (current?.status === 'processing' && Date.parse(String(current.leaseUntil)) > now.getTime()) return false;
    await r.put('queueExecutions', { id: executionId, taskId: task.id, taskName: name, reference: reference(data), status: 'processing', attempt: task.attempt, maxAttempts: policy.attempts, startedAt: now.toISOString(), leaseUntil: new Date(now.getTime() + policy.timeoutMs).toISOString(), updatedAt: now.toISOString() });
    return true;
  });
  if (!claimed) return { duplicate: true as const };
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([handler(data, { taskId: task.id, attempt: task.attempt }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('QUEUE_TASK_TIMEOUT')), policy.timeoutMs); })]); }
    finally { clearTimeout(timer); }
    await transaction(async r => {
      const current = await r.get<Row>('queueExecutions', executionId); if (current?.status !== 'processing' || current.attempt !== task.attempt) return;
      await r.put('queueExecutions', { ...current, status: 'completed', leaseUntil: undefined, finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await r.put('workerRuns', { id: randomUUID(), taskId: task.id, worker: name, status: 'completed', attempt: task.attempt, startedAt: current.startedAt, finishedAt: new Date().toISOString(), createdAt: new Date().toISOString(), expiresAtDate: retentionExpiry('operational') });
    });
    return { duplicate: false as const, status: 'completed' as const };
  } catch (error) {
    const code = failureCode(error), terminal = task.attempt >= policy.attempts;
    await transaction(async r => {
      const current = await r.get<Row>('queueExecutions', executionId); if (current?.status !== 'processing' || current.attempt !== task.attempt) return;
      await r.put('queueExecutions', { ...current, status: terminal ? 'dead_lettered' : 'retry_scheduled', code, leaseUntil: undefined, failedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await r.put('workerRuns', { id: randomUUID(), taskId: task.id, worker: name, status: terminal ? 'dead_lettered' : 'retry_scheduled', code, attempt: task.attempt, createdAt: new Date().toISOString(), expiresAtDate: retentionExpiry('operational') });
      if (terminal) {
        await r.put('deadLetterJobs', { id: executionId, taskId: task.id, taskName: name, reference: reference(data), code, attempts: task.attempt, status: 'pending', failedAt: new Date().toISOString() });
        await audit(r, 'queue-worker', 'queue.dead_lettered', executionId);
      }
    });
    throw new ApiError(terminal ? 422 : 503, code, terminal ? 'Background work requires administrator review.' : 'Background work will be retried.');
  }
}

export async function queueOverview(actor: User) {
  return read(async r => {
    await requireAdmin(r, actor);
    return { executions: { processing: await r.count('queueExecutions', { status: 'processing' }), retryScheduled: await r.count('queueExecutions', { status: 'retry_scheduled' }), deadLettered: await r.count('queueExecutions', { status: 'dead_lettered' }) }, deadLetters: await r.count('deadLetterJobs', { status: 'pending' }), recentRuns: await r.find('workerRuns', {}, 50) };
  });
}

async function requireAdmin(r: Repository, actor: User) {
  const current = await r.get<User>('users', actor.id);
  if (!current || current.disabled || current.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
}

export async function replayDeadLetter(actor: User, id: string, enqueue: (name: QueueTaskName, data: Record<string, string>, jobId: string) => Promise<void>) {
  const row = await read(async r => { await requireAdmin(r, actor); const item = await r.get<Row>('deadLetterJobs', id); if (!item) throw new ApiError(404, 'DEAD_LETTER_NOT_FOUND', 'Dead-letter job not found.'); if (item.status !== 'pending') throw new ApiError(409, 'DEAD_LETTER_FINAL', 'Dead-letter job was already replayed.'); return item; });
  const jobId = `replay-${randomUUID()}`; await enqueue(row.taskName as QueueTaskName, (row.reference || {}) as Record<string, string>, jobId);
  await transaction(async r => { await requireAdmin(r, actor); const current = await r.get<Row>('deadLetterJobs', id); if (!current || current.status !== 'pending') throw new ApiError(409, 'DEAD_LETTER_FINAL', 'Dead-letter job was already replayed.'); await r.put('deadLetterJobs', { ...current, status: 'replayed', replayJobId: jobId, replayedAt: new Date().toISOString(), replayedBy: actor.id }); await audit(r, actor.id, 'queue.dead_letter_replayed', id); });
  return { replayJobId: jobId };
}

export async function closeQueueResources(resources: { close(): Promise<unknown> }[], timeoutMs = 15_000) {
  for (const resource of resources) await deadline(resource.close(), timeoutMs, 'QUEUE_SHUTDOWN_TIMEOUT');
}
