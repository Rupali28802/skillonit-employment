import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { sampleJobs } from '../src/lib/fixtures.js';

// An isolated, real MongoDB replica set. Never reads .env or a user's database.
const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = replica.getUri();
process.env.MONGODB_DATABASE = 'architecture_test';
process.env.DEMO_MODE = 'true';
process.env.APP_URL = 'http://localhost:3000';
const { bootstrapIndexes, transaction, read, closeStore } =
  await import('../src/lib/store.js');
const { app } = await import('../src/app.js');
const client = new MongoClient(replica.getUri());
let server: ReturnType<typeof app.listen> | undefined;
try {
  await bootstrapIndexes();
  await transaction(async (r) => {
    for (const job of sampleJobs()) await r.put('jobs', job);
  });
  await assert.rejects(
    transaction(async (r) => {
      await r.put('leads', { id: 'rollback-probe', subject: 'Must roll back' });
      throw new Error('Deliberate transaction rollback');
    }),
  );
  assert.equal(await read((r) => r.get('leads', 'rollback-probe')), null);
  const indexes = await client
    .db('architecture_test')
    .collection('sessions')
    .indexes();
  assert.ok(indexes.some((index) => index.expireAfterSeconds === 0));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['tests/integration.mjs'], {
      stdio: 'inherit',
      env: { ...process.env, TEST_URL: `http://127.0.0.1:${address.port}` },
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`API suite exited ${code}`)),
    );
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['tests/features.mjs'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_URL: `http://127.0.0.1:${address.port}`,
        TEST_ORIGIN: 'http://localhost:3000',
      },
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Feature suite exited ${code}`)),
    );
  });
  assert.ok(
    await client
      .db('architecture_test')
      .collection('leads')
      .findOne({ subject: 'Local test enquiry' }),
  );
  assert.ok(
    (await client
      .db('architecture_test')
      .collection('applications')
      .countDocuments()) > 0,
  );
  const { expireJobs } = await import('../src/lib/lifecycle.js');
  const expired = sampleJobs()[0];
  await client
    .db('architecture_test')
    .collection('jobs')
    .insertMany(
      Array.from({ length: 1050 }, (_, i) => ({
        ...expired,
        id: `retention-${String(i).padStart(5, '0')}`,
        discoveredAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-04-01T00:00:00.000Z',
      })),
    );
  const before = await client
    .db('architecture_test')
    .collection('applications')
    .countDocuments();
  assert.equal(await expireJobs(), 1050);
  assert.equal(await expireJobs(), 0, 'Retention must be idempotent');
  assert.equal(
    await client
      .db('architecture_test')
      .collection('applications')
      .countDocuments(),
    before,
  );
  console.log(
    'PASS: real MongoDB indexes, transaction rollback, API workflows and persisted contact/application records.',
  );
} finally {
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
  await closeStore();
  await client.close();
  await replica.stop();
}
