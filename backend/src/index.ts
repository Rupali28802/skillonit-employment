import { module2Config } from './lib/module2-config.js';
import { productionCvProviders } from './lib/cv-production.js';
import { app } from './app.js';
import { bootstrapIndexes, closeStore, demoMode, read } from './lib/store.js';
import { validateRuntime } from './lib/runtime-config.js';
import { module2ProductionIssues } from './lib/module2-production-config.js';
import { safeLog } from './lib/safe-logger.js';
import { productionPolicy } from './lib/production-readiness.js';
import { closeHttpServer } from './lib/graceful-shutdown.js';

try {
  validateRuntime(); module2Config();
  if (process.env.NODE_ENV === 'production') {
    const issues = module2ProductionIssues();
    if (issues.length) { safeLog('error', 'startup.configuration_invalid', { code: 'MISSING_OR_INVALID_CONFIG' }); throw new Error('Module 2 production configuration required'); }
  }
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_CV_UPLOADS !== 'true') throw new Error('Module 2 CV production configuration required');
  if (process.env.ENABLE_CV_UPLOADS === 'true') await productionCvProviders().check();
  if (process.env.DATABASE_URL || process.env.MONGODB_URI) {
    await bootstrapIndexes();
    if (process.env.NODE_ENV === 'production') await read(async r => {
      const catalog = await r.get<{ value: { source?: string } }>('systemConfig', 'student-catalog-policy');
      if (catalog?.value.source !== 'managed' || !(await r.get('systemConfig', 'profile-completion'))) throw new Error('Module 2 managed policy required');
      for (const collection of ['occupationFamilies', 'locations', 'skills']) if (!(await r.count(collection, { active: true }))) throw new Error('Module 2 active catalog required');
    });
    safeLog('info', process.env.DATABASE_URL ? 'postgresql.connected' : 'mongodb.connected');
  }
  else if (!demoMode()) throw new Error('Missing persistence');
} catch {
  // Driver/configuration exceptions can contain credentials. Never print them.
  safeLog('error', 'backend.startup_failed', { code: 'CONFIGURATION_OR_DEPENDENCY' });
  process.exit(1);
}
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  safeLog('info', 'backend.listening');
});
let closing = false;
const shutdown = async (reason: string, failed = false) => {
  if (closing) return; closing = true; safeLog('info', 'backend.shutdown_started', { reason });
  try { await closeHttpServer(server, closeStore, productionPolicy().shutdownTimeoutMs); process.exitCode = failed ? 1 : 0; }
  catch { safeLog('error', 'backend.shutdown_failed'); process.exitCode = 1; }
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void shutdown(signal); });
}
process.once('uncaughtException', () => { safeLog('error', 'backend.uncaught_exception'); void shutdown('uncaughtException', true); });
process.once('unhandledRejection', () => { safeLog('error', 'backend.unhandled_rejection'); void shutdown('unhandledRejection', true); });
