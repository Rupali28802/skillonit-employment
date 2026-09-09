import { cvProductionConfig, productionCvProviders } from './lib/cv-production.js';
import { module2Config } from './lib/module2-config.js';
import { validateCvProviders } from './lib/cv-provider-validation.js';

// Never serialize environment values, Zod errors, provider messages or extracted facts.
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--live') || args.length > 1) {
    console.error('Usage: npm run cv:check -- [--live]'); process.exitCode = 1; return;
  }
  try { cvProductionConfig(); module2Config(); }
  catch {
    console.error('CV provider configuration: FAIL. Configure private S3 storage, HTTPS scanner/parser gateways and Module 2 limits using backend/.env.example. No values were printed.');
    process.exitCode = 1; return;
  }
  console.info('CV provider configuration: PASS (syntax only).');
  if (!args.includes('--live')) { console.info('Live providers: NOT_RUN. Use --live to upload, scan, parse and clean up one generated non-personal PDF.'); return; }
  const report = await validateCvProviders(productionCvProviders());
  console.info(JSON.stringify(report));
  console.info('This checks provider connectivity/contracts only. It does not certify malware detection, extraction accuracy, backup deletion or production readiness.');
  if (Object.values(report).some(value => value !== 'PASS')) process.exitCode = 1;
}
main().catch(() => { console.error('CV provider validation: FAIL. Diagnostics suppressed to protect credentials and document contents.'); process.exitCode = 1; });
