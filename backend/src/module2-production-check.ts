import { module2ProductionIssues } from './lib/module2-production-config.js';
import { checkModule2Redis } from './lib/module2-redis.js';

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--redis')) throw new Error();
  const issues = module2ProductionIssues();
  if (issues.length) {
    console.error('MISSING_OR_INVALID_CONFIG:\n' + issues.join('\n'));
    process.exitCode = 1; return;
  }
  console.info('Module 2 production configuration syntax: PASS. Live providers, policies and worker validation are separate checks.');
  if (process.argv.includes('--redis')) {
    await checkModule2Redis(); console.info('Redis connectivity: PASS.');
  }
}
main().catch(error => {
  const code = error instanceof Error && /^REDIS_(?:REQUEST_QUOTA_EXCEEDED|CONNECTION_LIMIT|AUTH_FAILED|COMMAND_NOT_PERMITTED|UNAVAILABLE)$/.test(error.message)
    ? error.message
    : 'MODULE2_VALIDATION_FAILED';
  console.error(`Module 2 validation failed: ${code}. Configuration/provider values withheld.`);
  process.exitCode = 1;
});
