import { module2Config } from './lib/module2-config.js';
import { productionCvProviders } from './lib/cv-production.js';
import { app } from './app.js';
import { bootstrapIndexes, closeStore, demoMode, read } from './lib/store.js';
import { cvUploadsEnabled, validateRuntime } from './lib/runtime-config.js';
import { module2ProductionIssues } from './lib/module2-production-config.js';
import { safeLog } from './lib/safe-logger.js';
import { productionPolicy } from './lib/production-readiness.js';
import { closeHttpServer } from './lib/graceful-shutdown.js';

try {
  validateRuntime(); module2Config();
  const production = process.env.NODE_ENV === 'production';
  const cvEnabled = cvUploadsEnabled();
  // CV processing is an optional production capability.  A deliberately
  // disabled upload surface must not force the whole API into development
  // mode; when enabled it remains fail-closed on every provider dependency.
  if (production && cvEnabled) {
    const issues = module2ProductionIssues();
    if (issues.length) { safeLog('error', 'startup.configuration_invalid', { code: 'MISSING_OR_INVALID_CONFIG' }); throw new Error('Module 2 production configuration required'); }
  }
  if (cvEnabled) await productionCvProviders().check();
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
  let exitCode = failed ? 1 : 0;
  try { await closeHttpServer(server, closeStore, productionPolicy().shutdownTimeoutMs); }
  catch { safeLog('error', 'backend.shutdown_failed'); exitCode = 1; }
  // `process.exitCode` alone leaves a process alive if a third-party handle
  // survives shutdown. Systemd would eventually SIGKILL it, extending an
  // avoidable deployment outage. Dependencies have now been closed.
  process.exit(exitCode);
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void shutdown(signal); });
}
process.once('uncaughtException', () => { safeLog('error', 'backend.uncaught_exception'); void shutdown('uncaughtException', true); });
process.once('unhandledRejection', () => { safeLog('error', 'backend.unhandled_rejection'); void shutdown('unhandledRejection', true); });
