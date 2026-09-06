import { app } from './app.js';
import { bootstrapIndexes, demoMode } from './lib/store.js';
import { validateRuntime } from './lib/runtime-config.js';

try {
  validateRuntime();
  if (process.env.MONGODB_URI) await bootstrapIndexes();
  else if (!demoMode()) throw new Error('Missing persistence');
} catch {
  // Driver/configuration exceptions can contain credentials. Never print them.
  console.error(
    'Backend startup configuration failed. Check local environment, MongoDB connectivity/topology and index permissions. Run npm run db:check for a safe database probe.',
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
