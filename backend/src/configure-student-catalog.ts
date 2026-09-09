import { readFile } from 'node:fs/promises';
import { configureCatalog } from './lib/student-catalog.js';
import { closeStore, bootstrapIndexes } from './lib/store.js';
// Explicit operator command only. No automatic production seeding or replacement.
try {
  const file = process.argv[2];
  if (!file) throw new Error('Configuration file required');
  const input: unknown = JSON.parse(await readFile(file, 'utf8'));
  await bootstrapIndexes();
  const result = await configureCatalog('system:catalog-configuration', input);
  console.info('Student catalog configured', result);
} catch {
  console.error('Student catalog configuration failed. Check configuration schema, hierarchy and database availability. Provider and credential details withheld.');
  process.exitCode = 1;
} finally { await closeStore(); }
