import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { User } from '../src/lib/domain.ts';

const profile = { name: '', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false };
const preferences = { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 5 };
const user = (id: string, role: User['role']): User => ({ id, email: `${id}@example.test`, name: id, passwordHash: null, role, plan: 'basic', verified: true, createdAt: '2026-01-01T00:00:00.000Z', profile, preferences });

test('queue execution is idempotent, retry-safe, dead-lettered and auditable without private errors', async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replica.getUri(); process.env.MONGODB_DATABASE = 'queue_infrastructure_test'; process.env.DEMO_MODE = 'true';
  const store = await import('../src/lib/store.ts'); const queue = await import('../src/lib/queue-infrastructure.ts');
  const admin = user('admin', 'admin'), student = user('student', 'student');
  try {
    await store.bootstrapIndexes(); await store.transaction(async r => { await r.put('users', admin); await r.put('users', student); });
    let completed = 0;
    assert.deepEqual(await queue.executeQueueTask({ id: 'success-1', name: 'auto-apply-user', data: { userId: student.id }, attempt: 1 }, async data => { completed++; assert.equal(data.userId, student.id); }), { duplicate: false, status: 'completed' });
    assert.deepEqual(await queue.executeQueueTask({ id: 'success-1', name: 'auto-apply-user', data: { userId: student.id }, attempt: 1 }, async () => { completed++; }), { duplicate: true });
    assert.equal(completed, 1);
    await assert.rejects(queue.executeQueueTask({ id: 'invalid-1', name: 'job-dedupe', data: { jobId: 'job-1', secret: 'must-not-persist' }, attempt: 1 }, async () => {}));

    const failure = async () => { throw new Error('private provider endpoint and credential'); };
    await assert.rejects(queue.executeQueueTask({ id: 'failed-1', name: 'job-dedupe', data: { jobId: 'job-1' }, attempt: 1 }, failure), { status: 503, code: 'QUEUE_TASK_FAILED' });
    await assert.rejects(queue.executeQueueTask({ id: 'failed-1', name: 'job-dedupe', data: { jobId: 'job-1' }, attempt: 2 }, failure), { status: 503, code: 'QUEUE_TASK_FAILED' });
    await assert.rejects(queue.executeQueueTask({ id: 'failed-1', name: 'job-dedupe', data: { jobId: 'job-1' }, attempt: 3 }, failure), { status: 422, code: 'QUEUE_TASK_FAILED' });
    const dead = await store.read(r => r.get<Record<string, unknown>>('deadLetterJobs', 'job-dedupe:failed-1'));
    assert.equal(dead?.status, 'pending'); assert.deepEqual(dead?.reference, { jobId: 'job-1' });
    assert.equal(JSON.stringify(dead).includes('credential'), false); assert.equal(JSON.stringify(dead).includes('endpoint'), false);

    const overview = await queue.queueOverview(admin); assert.equal(overview.deadLetters, 1); assert.equal(overview.executions.deadLettered, 1);
    await assert.rejects(queue.queueOverview(student), { code: 'FORBIDDEN' });
    let replay: { name?: string; data?: Record<string, string>; jobId?: string } = {};
    const result = await queue.replayDeadLetter(admin, 'job-dedupe:failed-1', async (name, data, jobId) => { replay = { name, data, jobId }; });
    assert.equal(replay.name, 'job-dedupe'); assert.deepEqual(replay.data, { jobId: 'job-1' }); assert.equal(replay.jobId, result.replayJobId);
    await assert.rejects(queue.replayDeadLetter(admin, 'job-dedupe:failed-1', async () => {}), { code: 'DEAD_LETTER_FINAL' });
    const audits = await store.read(r => r.find<Record<string, unknown>>('auditLogs', {}, 20));
    assert.ok(audits.some(row => row.action === 'queue.dead_lettered')); assert.ok(audits.some(row => row.action === 'queue.dead_letter_replayed'));
  } finally { await store.closeStore(); await replica.stop(); delete process.env.MONGODB_URI; delete process.env.MONGODB_DATABASE; }
});

test('queue schedules, policies, Redis safety and graceful closure are bounded', async () => {
  const queue = await import('../src/lib/queue-infrastructure.ts');
  const schedules = queue.configuredSchedules({ ENABLE_APPLICATION_ENGINE: 'true', ENABLE_NOTIFICATION_PLATFORM: 'true', ENABLE_JOB_INGESTION_PIPELINE: 'true', ENABLE_JOB_VERIFICATION: 'true' } as NodeJS.ProcessEnv);
  assert.deepEqual(schedules.map(row => row.name), ['application-sender', 'auto-apply-scheduler', 'subscription-expiry', 'job-ingestion', 'job-verify', 'notification-dispatch', 'data-retention']);
  assert.equal(schedules.find(row => row.name === 'job-verify')?.every, 300_000);
  assert.equal(schedules.find(row => row.name === 'data-retention')?.every, 86_400_000);
  assert.equal(queue.configuredSchedules({ DATABASE_URL: 'postgresql://localhost/isolated' }).find(row => row.name === 'data-retention')?.every, 60_000);
  assert.ok(!queue.configuredSchedules({ DATABASE_URL: 'postgresql://localhost/isolated', ENABLE_RETENTION_MAINTENANCE: 'false' }).some(row => row.name === 'data-retention'));
  assert.equal(queue.taskPolicies['application-sender'].attempts, 5); assert.ok(queue.taskPolicies['cv-process'].timeoutMs <= 15 * 60_000);
  assert.throws(() => queue.queueConnection({ REDIS_URL: 'https://example.test', MONGODB_URI: 'configured' } as NodeJS.ProcessEnv));
  const closed: number[] = [];
  await queue.closeQueueResources([{ async close() { closed.push(1); } }, { async close() { closed.push(2); } }], 100);
  assert.deepEqual(closed, [1, 2]);
});
