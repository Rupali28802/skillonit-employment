import { z } from 'zod';
import { productionCvProviders } from '../lib/cv-production.js';
import { closeStore, bootstrapIndexes } from '../lib/store.js';
import { safeLog } from '../lib/safe-logger.js';
import { runCvBatch, runCvMaintenance } from './cv.js';

export function directCvWorkerConfig(env = process.env) {
  if (env.ENABLE_CV_UPLOADS !== 'true') throw new Error('CV_UPLOADS_DISABLED');
  return {
    pollIntervalMs: z.coerce.number().int().min(5_000).max(300_000).default(15_000).parse(env.CV_DIRECT_POLL_INTERVAL_MS),
  };
}

/**
 * Redis-free recovery worker. CV jobs remain persisted in the database and
 * retain their normal leases, attempts, malware scan and parser checks.
 */
export async function startDirectCvWorker(env = process.env) {
  const { pollIntervalMs } = directCvWorkerConfig(env);
  await productionCvProviders().check();
  await bootstrapIndexes();

  let running = false;
  let maintenanceAt = 0;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runCvBatch();
      if (Date.now() >= maintenanceAt) {
        await runCvMaintenance();
        maintenanceAt = Date.now() + 3_600_000;
      }
      safeLog('info', 'cv_direct_worker.cycle_completed', { processed: result.processed });
    } catch {
      // Provider details can contain secrets or file metadata; keep logs safe.
      safeLog('error', 'cv_direct_worker.cycle_failed');
    } finally {
      running = false;
    }
  };

  await run();
  const timer = setInterval(() => { void run(); }, pollIntervalMs);
  safeLog('info', 'cv_direct_worker.started', { pollIntervalMs });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    await closeStore().catch(() => {});
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

if (process.argv[1]?.endsWith('cv-direct.js')) {
  startDirectCvWorker().catch(async () => {
    safeLog('error', 'cv_direct_worker.startup_failed');
    await closeStore().catch(() => {});
    process.exitCode = 1;
  });
}
