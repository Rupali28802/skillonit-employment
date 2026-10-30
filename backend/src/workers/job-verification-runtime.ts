import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { verifyJobs } from '../lib/job-verification.js';
import { executeQueueTask } from '../lib/queue-infrastructure.js';
import { safeLog } from '../lib/safe-logger.js';

export const jobVerificationWorkerName = 'database-job-verification';
export const jobVerificationSchedulerId = 'job-verify';

export function jobVerificationWorkerConfig(env = process.env) {
  if (env.ENABLE_JOB_VERIFICATION !== 'true') throw new Error('JOB_VERIFICATION_DISABLED');
  return {
    every: z.coerce.number().int().min(300_000).max(86_400_000).default(300_000).parse(env.JOB_VERIFICATION_INTERVAL_MS),
    batchSize: z.coerce.number().int().min(1).max(25).default(10).parse(env.JOB_VERIFICATION_BATCH_SIZE),
  };
}

export async function runJobVerificationTask(name: string, data: unknown, taskId: string, attempt: number, batchSize = 10) {
  if (name !== 'job-verify') throw new Error('JOB_VERIFICATION_TASK_NOT_ALLOWED');
  const payload = z.object({ jobId: z.string().min(1).max(100).optional() }).strict().parse(data);
  return executeQueueTask({ id: taskId, name: 'job-verify', data: payload, attempt }, (_, context) =>
    verifyJobs(context.taskId, payload.jobId ? { jobId: payload.jobId } : { limit: batchSize }));
}

export async function startJobVerificationWorker(env = process.env) {
  const config = jobVerificationWorkerConfig(env);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runJobVerificationTask('job-verify', {}, `${jobVerificationSchedulerId}:${randomUUID()}`, 1, config.batchSize); }
    catch { safeLog('warn', 'job_verification_worker.task_failed'); }
    finally { running = false; }
  };
  await run();
  const timer = setInterval(() => { void run(); }, config.every);
  return { workerName: jobVerificationWorkerName, every: config.every, batchSize: config.batchSize, close: async () => { clearInterval(timer); } };
}
