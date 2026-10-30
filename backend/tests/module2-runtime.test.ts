import { test } from 'node:test';
import assert from 'node:assert/strict';
import { module2ProductionIssues } from '../src/lib/module2-production-config.js';
import { processModule2Task, cvJobOptions } from '../src/workers/module2-runtime.js';
import { directCvWorkerConfig } from '../src/workers/cv-direct.js';

test('Module 2 production gate requires providers but has no Redis configuration', () => {
  const missing = module2ProductionIssues({});
  for (const name of ['MONGODB_URI', 'APP_URL', 'AUTH_OTP_SECRET', 'CV_GOOGLE_DRIVE_CLIENT_ID', 'CV_GOOGLE_DRIVE_REFRESH_TOKEN', 'CV_GOOGLE_DRIVE_FOLDER_ID', 'CV_SCANNER_TOKEN', 'CV_PARSER_TOKEN']) assert.ok(missing.includes(name));
  assert.ok(!missing.includes('REDIS_URL'));
  assert.ok(!missing.includes('REDIS_CONFIG'));
  const output = module2ProductionIssues({ MONGODB_URI: 'invalid-private-fixture', CV_PARSER_URL: 'invalid-private-fixture' });
  assert.ok(!JSON.stringify(output).includes('private-fixture'));
  assert.ok(output.includes('MONGODB_URI'));
  const postgres = module2ProductionIssues({ DATABASE_URL: 'postgresql://localhost/skillonit_test' });
  for (const name of ['DATABASE_URL', 'MONGODB_URI', 'MONGODB_DATABASE']) assert.ok(!postgres.includes(name));
  assert.ok(module2ProductionIssues({ DATABASE_URL: 'https://example.test' }).includes('DATABASE_URL'));
});

test('Module 2 worker task boundaries and provider failures retain only safe error codes', async () => {
  let called = 0;
  const handlers = { process: async () => { called++; return { available: true, processed: 1 }; }, maintenance: async () => ({ available: true, deleted: 1, failed: 0 }) };
  assert.equal((await processModule2Task('cv-process', handlers)).available, true);
  await assert.rejects(processModule2Task('not-a-module2-task', handlers), { message: 'MODULE2_TASK_NOT_ALLOWED' }); assert.equal(called, 1);
  await assert.rejects(processModule2Task('cv-process', { ...handlers, process: async () => { throw new Error('private-provider-fixture'); } }), { message: 'MODULE2_CV_TASK_FAILED' });
  await assert.rejects(processModule2Task('cv-maintenance', { ...handlers, maintenance: async () => ({ available: true, deleted: 0, failed: 1 }) }), { message: 'MODULE2_CV_TASK_FAILED' });
  assert.equal(cvJobOptions.attempts, 3); assert.equal(cvJobOptions.backoff.type, 'exponential');
});

test('database-backed CV worker is explicit, bounded and never enables uploads on its own', () => {
  assert.deepEqual(directCvWorkerConfig({ ENABLE_CV_UPLOADS: 'true' }), { pollIntervalMs: 15_000 });
  assert.deepEqual(directCvWorkerConfig({ ENABLE_CV_UPLOADS: 'true', CV_DIRECT_POLL_INTERVAL_MS: '5000' }), { pollIntervalMs: 5_000 });
  assert.throws(() => directCvWorkerConfig({ ENABLE_CV_UPLOADS: 'false' }), /CV_UPLOADS_DISABLED/);
});
