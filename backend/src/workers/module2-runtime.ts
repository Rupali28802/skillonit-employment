import { Queue, Worker, UnrecoverableError } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { createModule2Redis, deadline } from '../lib/module2-redis.js';
import { transaction } from '../lib/store.js';
import { runCvBatch, runCvMaintenance } from './cv.js';

export const module2QueueName = 'skillonit-cv';
export const cvJobOptions = { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { count: 100 }, removeOnFail: { count: 1000 } };
export async function processModule2Task(name: string, handlers = { process: runCvBatch, maintenance: runCvMaintenance }) {
  if (name !== 'cv-process' && name !== 'cv-maintenance') throw new UnrecoverableError('MODULE2_TASK_NOT_ALLOWED');
  try {
    const result = await (name === 'cv-process' ? handlers.process() : handlers.maintenance());
    if (!result.available) throw new Error();
    if ('failed' in result && result.failed) throw new Error();
    return result;
  } catch { throw new Error('MODULE2_CV_TASK_FAILED'); }
}
export async function startModule2Worker(env = process.env) {
  const connection = createModule2Redis(env);
  let queue: Queue | undefined, worker: Worker | undefined;
  try {
    await deadline(connection.connect(), 15000, 'REDIS_UNAVAILABLE');
    queue = new Queue(module2QueueName, { connection, defaultJobOptions: cvJobOptions });
    queue.on('error', () => console.error('Module 2 queue connection error; details withheld.'));
    await deadline(queue.waitUntilReady(), 15000, 'REDIS_UNAVAILABLE');
    await deadline(queue.upsertJobScheduler('cv-process', { every: 60000 }, { name: 'cv-process', data: {}, opts: cvJobOptions }), 15000, 'CV_SCHEDULER_FAILED');
    await deadline(queue.upsertJobScheduler('cv-maintenance', { every: 3600000 }, { name: 'cv-maintenance', data: {}, opts: cvJobOptions }), 15000, 'CV_SCHEDULER_FAILED');
    worker = new Worker(module2QueueName, async task => {
      const runId = randomUUID(), startedAt = new Date().toISOString();
      try {
        const result = await processModule2Task(task.name);
        await transaction(r => r.put('workerRuns', { id: runId, taskId: task.id, worker: task.name, status: 'completed', startedAt, finishedAt: new Date().toISOString(), result }));
        return result;
      } catch {
        // Neither BullMQ failedReason nor MongoDB run records receive provider errors.
        try { await transaction(r => r.put('workerRuns', { id: runId, taskId: task.id, worker: task.name === 'cv-process' || task.name === 'cv-maintenance' ? task.name : 'unknown', status: 'failed', code: 'MODULE2_CV_TASK_FAILED', startedAt })); }
        catch { console.error('Module 2 run audit unavailable; sanitized failure retained in the queue.'); }
        if (!['cv-process', 'cv-maintenance'].includes(task.name)) throw new UnrecoverableError('MODULE2_TASK_NOT_ALLOWED');
        throw new Error('MODULE2_CV_TASK_FAILED');
      }
    }, { connection, concurrency: 2, maxStalledCount: 1, limiter: { max: 10, duration: 60000 } });
    worker.on('error', () => console.error('Module 2 worker connection error; details withheld.'));
    await deadline(worker.waitUntilReady(), 15000, 'CV_WORKER_START_FAILED');
    const activeWorker = worker, activeQueue = queue;
    let closing: Promise<void> | undefined;
    return { close() {
      return closing ??= (async () => {
        try { await deadline(activeWorker.close(), 30000, 'CV_WORKER_SHUTDOWN_TIMEOUT'); }
        finally {
          await deadline(activeQueue.close(), 5000, 'CV_QUEUE_SHUTDOWN_TIMEOUT').catch(() => {});
          connection.disconnect();
        }
      })();
    } };
  } catch {
    if (worker) await deadline(worker.close(true), 5000, 'CV_WORKER_CLOSE_FAILED').catch(() => {});
    if (queue) await deadline(queue.close(), 5000, 'CV_QUEUE_CLOSE_FAILED').catch(() => {});
    connection.disconnect(); throw new Error('MODULE2_WORKER_START_FAILED');
  }
}
