import { module2Config } from './lib/module2-config.js';
import { productionCvProviders } from './lib/cv-production.js';
import { app } from './app.js';
import { bootstrapIndexes, demoMode, read } from './lib/store.js';
import { validateRuntime } from './lib/runtime-config.js';
import { module2ProductionIssues } from './lib/module2-production-config.js';

try {
  validateRuntime(); module2Config();
  if (process.env.NODE_ENV === 'production') {
    const issues = module2ProductionIssues();
    if (issues.length) { console.error('MISSING_OR_INVALID_CONFIG:\n' + issues.join('\n')); throw new Error('Module 2 production configuration required'); }
  }
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_CV_UPLOADS !== 'true') throw new Error('Module 2 CV production configuration required');
  if (process.env.ENABLE_CV_UPLOADS === 'true') await productionCvProviders().check();
  if (process.env.MONGODB_URI) {
    await bootstrapIndexes();
    if (process.env.NODE_ENV === 'production') await read(async r => {
      const catalog = await r.get<{ value: { source?: string } }>('systemConfig', 'student-catalog-policy');
      if (catalog?.value.source !== 'managed' || !(await r.get('systemConfig', 'profile-completion'))) throw new Error('Module 2 managed policy required');
      for (const collection of ['occupationFamilies', 'locations', 'skills']) if (!(await r.count(collection, { active: true }))) throw new Error('Module 2 active catalog required');
    });
    const database = process.env.MONGODB_DATABASE || 'skillonit';
    console.log('MongoDB connected: ' + (/^[A-Za-z0-9_-]+$/.test(database) ? database : '[configured database]'));
  }
  else if (!demoMode()) throw new Error('Missing persistence');
} catch {
  // Driver/configuration exceptions can contain credentials. Never print them.
  console.error(
    'Backend startup configuration failed. Check local environment, MongoDB/index permissions and Module 2 private-storage/scanner/parser/catalog/completion configuration. Run npm run db:check for a safe database probe.',
  );
  process.exit(1);
}
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`SkillonIT Express backend listening on port ${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
