import { Queue, UnrecoverableError, Worker, type ConnectionOptions } from 'bullmq';
import { z } from 'zod';
import { verifyJobs } from '../lib/job-verification.js';
import { executeQueueTask, queueConnection, taskPolicies } from '../lib/queue-infrastructure.js';
import { deadline } from '../lib/module2-redis.js';
import { safeLog } from '../lib/safe-logger.js';

export const jobVerificationQueueName = 'skillonit-job-verification';
export const jobVerificationSchedulerId = 'job-verify';

export function jobVerificationWorkerConfig(env = process.env) {
  if (env.ENABLE_JOB_VERIFICATION !== 'true') throw new Error('JOB_VERIFICATION_DISABLED');
  return {
    every: z.coerce.number().int().min(300_000).max(86_400_000).default(300_000).parse(env.JOB_VERIFICATION_INTERVAL_MS),
    batchSize: z.coerce.number().int().min(1).max(25).default(10).parse(env.JOB_VERIFICATION_BATCH_SIZE),
    connection: queueConnection(env) as ConnectionOptions,
  };
}

export async function runJobVerificationTask(name: string, data: unknown, taskId: string, attempt: number, batchSize = 10) {
  if (name !== 'job-verify') throw new UnrecoverableError('JOB_VERIFICATION_TASK_NOT_ALLOWED');
  const payload = z.object({ jobId: z.string().min(1).max(100).optional() }).strict().parse(data);
  return executeQueueTask({ id: taskId, name: 'job-verify', data: payload, attempt }, (_, context) =>
    verifyJobs(context.taskId, payload.jobId ? { jobId: payload.jobId } : { limit: batchSize }));
}

export async function startJobVerificationWorker(env = process.env) {
  const config = jobVerificationWorkerConfig(env), policy = taskPolicies['job-verify'];
  const queue = new Queue(jobVerificationQueueName, { connection: config.connection });
  queue.on('error', () => safeLog('error', 'job_verification_queue.connection_error'));
  let worker: Worker | undefined;
  try {
    await queue.upsertJobScheduler(jobVerificationSchedulerId, { every: config.every }, {
      name: 'job-verify', data: {}, opts: { attempts: policy.attempts, backoff: { type: 'exponential', delay: policy.backoffMs }, removeOnComplete: { count: 500 }, removeOnFail: { count: 2000 } },
    });
    worker = new Worker(jobVerificationQueueName, task => runJobVerificationTask(task.name, task.data, String(task.id), task.attemptsMade + 1, config.batchSize), {
      connection: config.connection, concurrency: 1, maxStalledCount: 1, limiter: { max: 12, duration: 60_000 },
    });
    worker.on('error', () => safeLog('error', 'job_verification_worker.connection_error'));
    worker.on('failed', task => safeLog('warn', 'job_verification_worker.task_failed', { task: task?.name || 'unknown', final: !!task && task.attemptsMade >= Number(task.opts.attempts || 1) }));
    await worker.waitUntilReady();
    const activeWorker = worker;
    return { queueName: jobVerificationQueueName, every: config.every, batchSize: config.batchSize, close: async () => {
      await deadline(activeWorker.close(), policy.timeoutMs + 15_000, 'JOB_VERIFICATION_WORKER_SHUTDOWN_TIMEOUT');
      await deadline(queue.close(), 5_000, 'JOB_VERIFICATION_QUEUE_SHUTDOWN_TIMEOUT');
    } };
  } catch (error) {
    if (worker) await worker.close(true).catch(() => {});
    await queue.close().catch(() => {});
    throw error;
  }
}
