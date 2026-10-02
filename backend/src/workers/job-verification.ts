import { closeStore } from '../lib/store.js';
import { safeLog } from '../lib/safe-logger.js';
import { startJobVerificationWorker } from './job-verification-runtime.js';

async function main() {
  const runtime = await startJobVerificationWorker();
  safeLog('info', 'job_verification_worker.started', { queue: runtime.queueName, intervalMs: runtime.every, batchSize: runtime.batchSize });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try { await runtime.close(); await closeStore(); process.exitCode = 0; }
    catch { safeLog('error', 'job_verification_worker.shutdown_failed'); process.exitCode = 1; }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(async () => {
  safeLog('error', 'job_verification_worker.startup_failed');
  await closeStore();
  process.exitCode = 1;
});
