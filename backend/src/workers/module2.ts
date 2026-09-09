import { requireModule2Production } from '../lib/module2-production-config.js';
import { productionCvProviders } from '../lib/cv-production.js';
import { bootstrapIndexes, closeStore } from '../lib/store.js';
import { startModule2Worker } from './module2-runtime.js';

async function main() {
  try { requireModule2Production(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'MODULE2_CONFIG_FAILED'); process.exitCode = 1; return; }
  await productionCvProviders().check();
  await bootstrapIndexes();
  const runtime = await startModule2Worker();
  console.info('Module 2 CV worker started.');
  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true;
    try { await runtime.close(); await closeStore(); process.exitCode = 0; }
    catch { console.error('Module 2 shutdown deadline exceeded; persisted leases allow recovery.'); process.exitCode = 1; }
    finally { process.exit(process.exitCode ?? 0); }
  };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
main().catch(async () => { console.error('Module 2 worker startup failed; provider details withheld.'); await closeStore(); process.exitCode = 1; });
