import { bootstrapIndexes, closeStore } from '../lib/store.js';
import { safeLog } from '../lib/safe-logger.js';
import { applicationSenderConfig, startApplicationSenderRuntime } from './application-sender-runtime.js';

async function main() {
  applicationSenderConfig();
  await bootstrapIndexes();
  const runtime = startApplicationSenderRuntime();
  safeLog('info', 'application_sender.started', { pollMs: runtime.config.pollMs, batch: runtime.config.batch });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await runtime.close();
      await closeStore();
      process.exitCode = 0;
    } catch {
      safeLog('error', 'application_sender.shutdown_failed');
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(async () => {
  safeLog('error', 'application_sender.startup_failed');
  await closeStore();
  process.exitCode = 1;
});
