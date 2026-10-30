import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { module2ProductionIssues } from '../src/lib/module2-production-config.js';
import { redisSettings, checkModule2Redis, deadline, module2RedisFailureCode } from '../src/lib/module2-redis.js';
import { processModule2Task, cvJobOptions, startModule2Worker } from '../src/workers/module2-runtime.js';
import { directCvWorkerConfig } from '../src/workers/cv-direct.js';

test('Module 2 production gate names missing variables without disclosing their values', () => {
  const missing = module2ProductionIssues({});
  for (const name of ['MONGODB_URI', 'APP_URL', 'AUTH_OTP_SECRET', 'CV_GOOGLE_DRIVE_CLIENT_ID', 'CV_GOOGLE_DRIVE_REFRESH_TOKEN', 'CV_GOOGLE_DRIVE_FOLDER_ID', 'CV_SCANNER_TOKEN', 'CV_PARSER_TOKEN', 'REDIS_URL']) assert.ok(missing.includes(name));
  const directMissing = module2ProductionIssues({ CV_PROCESSING_MODE: 'direct' });
  assert.ok(!directMissing.includes('REDIS_URL'));
  assert.ok(!directMissing.includes('REDIS_CONFIG'));
  const output = module2ProductionIssues({ MONGODB_URI: 'invalid-private-fixture', REDIS_URL: 'https://user:private-fixture@example.test', CV_PARSER_URL: 'invalid-private-fixture' });
  assert.ok(!JSON.stringify(output).includes('private-fixture'));
  assert.ok(output.includes('MONGODB_URI'));
  const postgres = module2ProductionIssues({ DATABASE_URL: 'postgresql://localhost/skillonit_test' });
  for (const name of ['DATABASE_URL', 'MONGODB_URI', 'MONGODB_DATABASE']) assert.ok(!postgres.includes(name));
  assert.ok(module2ProductionIssues({ DATABASE_URL: 'https://example.test' }).includes('DATABASE_URL'));
});
test('Module 2 Redis configuration preserves TLS, database selection and bounded backoff', () => {
  const options = redisSettings({ REDIS_URL: 'rediss://user:p%40ss@example.test:6380/2', NODE_ENV: 'production' });
  assert.equal(options.db, 2); assert.equal(options.password, 'p@ss'); assert.ok(options.tls); assert.notEqual(options.tls.rejectUnauthorized, false);
  assert.equal(options.maxRetriesPerRequest, null); assert.equal(options.enableOfflineQueue, false);
  const retry = options.retryStrategy!;
  assert.equal(retry(1), 250); assert.equal(retry(4), null);
  for (const url of ['redis://example.test', 'https://example.test', 'rediss://example.test/?secret=value', 'rediss://example.test/not-a-db']) assert.throws(() => redisSettings({ REDIS_URL: url, NODE_ENV: 'production' }));
});
test('Module 2 Redis diagnostics classify actionable failures without retaining provider text', () => {
  assert.equal(module2RedisFailureCode(new Error('ERR max requests limit exceeded. Limit: 500000.')), 'REDIS_REQUEST_QUOTA_EXCEEDED');
  assert.equal(module2RedisFailureCode(new Error('ERR max number of clients reached')), 'REDIS_CONNECTION_LIMIT');
  assert.equal(module2RedisFailureCode(new Error('NOAUTH Authentication required.')), 'REDIS_AUTH_FAILED');
  assert.equal(module2RedisFailureCode(new Error('NOPERM this user has no permissions')), 'REDIS_COMMAND_NOT_PERMITTED');
  assert.equal(module2RedisFailureCode(new Error('private-provider-fixture')), 'REDIS_UNAVAILABLE');
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
test('Module 2 Redis outage and worker startup fail within deadline and release resources', async () => {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));
  const env = { REDIS_URL: `redis://127.0.0.1:${address.port}`, NODE_ENV: 'test', REDIS_CONNECT_TIMEOUT_MS: '100', REDIS_CONNECT_RETRIES: '0' };
  await assert.rejects(checkModule2Redis(env), { message: 'REDIS_UNAVAILABLE' });
  await assert.rejects(startModule2Worker(env), { message: 'MODULE2_WORKER_START_FAILED' });
  await assert.rejects(deadline(new Promise(() => {}), 5, 'FIXED_TIMEOUT'), { message: 'FIXED_TIMEOUT' });
});

test('direct CV worker is explicit, bounded and never enables uploads on its own', () => {
  assert.deepEqual(directCvWorkerConfig({ ENABLE_CV_UPLOADS: 'true', CV_PROCESSING_MODE: 'direct' }), { pollIntervalMs: 15_000 });
  assert.deepEqual(directCvWorkerConfig({ ENABLE_CV_UPLOADS: 'true', CV_PROCESSING_MODE: 'direct', CV_DIRECT_POLL_INTERVAL_MS: '5000' }), { pollIntervalMs: 5_000 });
  assert.throws(() => directCvWorkerConfig({ ENABLE_CV_UPLOADS: 'false', CV_PROCESSING_MODE: 'direct' }), /CV_UPLOADS_DISABLED/);
  assert.throws(() => directCvWorkerConfig({ ENABLE_CV_UPLOADS: 'true', CV_PROCESSING_MODE: 'queue' }), /CV_DIRECT_WORKER_DISABLED/);
});
