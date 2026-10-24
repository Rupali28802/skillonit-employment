import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { User } from '../src/lib/domain.ts';

const profile = { name: '', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false };
const preferences = { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 5 };
const user = (id: string, role: User['role']): User => ({ id, email: `${id}@example.test`, name: id, passwordHash: null, role, plan: 'basic', verified: true, createdAt: '2026-01-01T00:00:00.000Z', profile, preferences });

test('structured logging and process metrics retain operational fields without secrets or paths', async () => {
  const observability = await import('../src/lib/observability.ts');
  const messages: string[] = [], original = console.info;
  console.info = (value?: unknown) => messages.push(String(value));
  try { observability.safeLog('info', 'request Bearer private-token-value', { correlationId: 'correlation-1', method: 'GET', routeGroup: 'jobs', status: 200, password: 'must-not-appear' } as Record<string, string | number>); }
  finally { console.info = original; }
  assert.equal(messages.length, 1); const row = JSON.parse(messages[0]);
  assert.equal(row.correlationId, 'correlation-1'); assert.equal(row.password, undefined); assert.equal(messages[0].includes('private-token-value'), false); assert.equal(messages[0].includes('must-not-appear'), false);
  assert.equal(observability.routeGroup('/api/v1/jobs/private-job-id'), 'jobs');
  observability.resetProcessMetricsForTest(); observability.recordHttpObservation('GET', 'jobs', 200, 25); observability.recordHttpObservation('GET', 'jobs', 503, 750);
  const metric = observability.processMetrics().requests['GET:jobs']; assert.equal(metric.count, 2); assert.equal(metric.errors, 1); assert.equal(metric.latency.le100, 1); assert.equal(metric.latency.le2000, 1);
});

test('security headers, global abuse controls, incident telemetry and admin overview are enforced', async () => {
  // A replica-set member can need longer than the library's 10-second default
  // on a busy Windows host. This is test-only and does not affect production.
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ launchTimeout: 30_000 }] });
  process.env.MONGODB_URI = replica.getUri(); process.env.MONGODB_DATABASE = 'observability_security_test'; process.env.DEMO_MODE = 'true'; process.env.NODE_ENV = 'test'; process.env.APP_URL = 'http://localhost:3000'; process.env.ABUSE_REQUESTS_PER_MINUTE = '30'; process.env.ABUSE_READS_PER_MINUTE = '30'; process.env.TRUST_PROXY_HOPS = '0'; process.env.OBSERVABILITY_METRICS_TOKEN = 'test-metrics-token-with-at-least-32-characters';
  const store = await import('../src/lib/store.ts'), observability = await import('../src/lib/observability.ts'), security = await import('../src/lib/security.ts'), { app, shouldSetHsts } = await import('../src/app.ts');
  const admin = user('observability-admin', 'admin'), student = user('observability-student', 'student');
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    await store.bootstrapIndexes(); await store.transaction(async r => { await r.put('users', admin); await r.put('users', student); await r.put('queueExecutions', { id: 'slow-task', status: 'processing', startedAt: '2026-01-01T00:00:00.000Z' }); await r.put('deadLetterJobs', { id: 'dead-task', status: 'pending' }); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('server'); const base = `http://127.0.0.1:${address.port}`;
    assert.equal(shouldSetHsts({ APP_URL: 'https://employment.example.test', NODE_ENV: 'test' }), true); assert.equal(shouldSetHsts({ APP_URL: 'http://localhost:3000', NODE_ENV: 'production' }), false);
    const first = await fetch(`${base}/api/v1/health`); assert.equal(first.status, 200); const health = await first.clone().json() as { data: unknown }; assert.deepEqual(health.data, { status: 'ok' }); assert.equal(first.headers.get('x-content-type-options'), 'nosniff'); assert.equal(first.headers.get('x-frame-options'), 'DENY'); assert.match(first.headers.get('content-security-policy') || '', /default-src 'none'/); assert.equal(first.headers.get('referrer-policy'), 'no-referrer'); assert.equal(first.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=(), payment=()'); assert.equal(first.headers.get('strict-transport-security'), null); assert.ok(first.headers.get('x-request-id'));
    assert.equal((await fetch(`${base}/api/v1/health/live`)).status, 200); assert.equal((await fetch(`${base}/api/v1/health/ready`)).status, 200);
    assert.equal((await fetch(`${base}/internal/metrics`)).status, 401); const metrics = await fetch(`${base}/internal/metrics`, { headers: { Authorization: `Bearer ${process.env.OBSERVABILITY_METRICS_TOKEN}` } }); assert.equal(metrics.status, 200); assert.match(await metrics.text(), /skillonit_http_requests_total/);
    let last = first; for (let index = 1; index <= 30; index++) last = await fetch(`${base}/api/v1/health`); assert.equal(last.status, 429); assert.equal(last.headers.get('retry-after'), '60');
    await observability.recordIncidentSignal({ correlationId: 'safe-correlation', routeGroup: 'jobs', status: 503, durationMs: 2500, classification: 'dependency' }, new Date('2026-06-15T12:00:00.000Z'));
    const overview = await observability.observabilityOverview(admin, new Date('2026-06-15T12:05:00.000Z')); assert.equal(overview.queue.deadLetters, 1); assert.equal(overview.incidents.byStatusClass['5xx'], 1); assert.ok(overview.alerts.some(row => row.code === 'DEAD_LETTERS_PENDING'));
    await assert.rejects(observability.observabilityOverview(student), { code: 'FORBIDDEN' }); assert.throws(() => security.abuseLimits({ ABUSE_REQUESTS_PER_MINUTE: '2' } as NodeJS.ProcessEnv));
    const persisted = await store.read(r => r.find<Record<string, unknown>>('incidentSignals', {}, 100)); const serialized = JSON.stringify(persisted); assert.equal(serialized.includes(admin.email), false); assert.equal(serialized.includes('password'), false); assert.equal(serialized.includes('token'), false);
    const indexes = await MongoClient.connect(replica.getUri()).then(async client => { try { return await client.db('observability_security_test').collection('incidentSignals').indexes(); } finally { await client.close(); } });
    assert.ok(indexes.some(index => index.key?.expiresAtDate === 1 && index.expireAfterSeconds === 0));
  } finally {
    server.close(); await once(server, 'close'); await store.closeStore(); await replica.stop();
    for (const key of ['MONGODB_URI', 'MONGODB_DATABASE', 'DEMO_MODE', 'NODE_ENV', 'APP_URL', 'ABUSE_REQUESTS_PER_MINUTE', 'ABUSE_READS_PER_MINUTE', 'TRUST_PROXY_HOPS', 'OBSERVABILITY_METRICS_TOKEN']) delete process.env[key];
  }
});
