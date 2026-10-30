import { randomUUID } from 'node:crypto';
import { productionCvProviders } from '../lib/cv-production.js';
import { bootstrapIndexes, transaction } from '../lib/store.js';
import { runCvBatch, runCvMaintenance } from './cv.js';
import { directCvWorkerConfig } from './cv-direct.js';

export const cvJobOptions = { attempts: 3, backoff: { type: 'exponential' as const, delay: 2000 } };

export async function processModule2Task(name: string, handlers = { process: runCvBatch, maintenance: runCvMaintenance }) {
  if (name !== 'cv-process' && name !== 'cv-maintenance') throw new Error('MODULE2_TASK_NOT_ALLOWED');
  try {
    const result = await (name === 'cv-process' ? handlers.process() : handlers.maintenance());
    if (!result.available || ('failed' in result && result.failed)) throw new Error();
    return result;
  } catch { throw new Error('MODULE2_CV_TASK_FAILED'); }
}

/** Legacy Module 2 entry point retained for deployment compatibility. It is a
 * single database-backed CV poller and has no Redis/BullMQ connection. */
export async function startModule2Worker(env = process.env) {
  const { pollIntervalMs } = directCvWorkerConfig(env);
  await productionCvProviders().check();
  await bootstrapIndexes();
  let running = false;
  let maintenanceAt = 0;
  const cycle = async () => {
    if (running) return;
    running = true;
    const runId = randomUUID(), startedAt = new Date().toISOString();
    try {
      const result = await processModule2Task('cv-process');
      if (Date.now() >= maintenanceAt) {
        await processModule2Task('cv-maintenance');
        maintenanceAt = Date.now() + 3_600_000;
      }
      await transaction(r => r.put('workerRuns', { id: runId, taskId: runId, worker: 'cv-process', status: 'completed', startedAt, finishedAt: new Date().toISOString(), result }));
    } catch {
      await transaction(r => r.put('workerRuns', { id: runId, taskId: runId, worker: 'cv-process', status: 'failed', code: 'MODULE2_CV_TASK_FAILED', startedAt, finishedAt: new Date().toISOString() })).catch(() => {});
    } finally { running = false; }
  };
  await cycle();
  const timer = setInterval(() => { void cycle(); }, pollIntervalMs);
  let closing = false;
  return { close: async () => { if (closing) return; closing = true; clearInterval(timer); } };
}
