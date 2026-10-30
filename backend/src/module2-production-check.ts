import { module2ProductionIssues } from './lib/module2-production-config.js';

async function main() {
  if (process.argv.length > 2) throw new Error();
  const issues = module2ProductionIssues();
  if (issues.length) {
    console.error('MISSING_OR_INVALID_CONFIG:\n' + issues.join('\n'));
    process.exitCode = 1; return;
  }
  console.info('Module 2 production configuration syntax: PASS. Live providers, policies and database-worker validation are separate checks.');
}
main().catch(error => {
  console.error('Module 2 validation failed: MODULE2_VALIDATION_FAILED. Configuration/provider values withheld.');
  process.exitCode = 1;
});
