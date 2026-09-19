import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { User } from '../src/lib/domain.ts';

const profile = { name: '', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false };
const preferences = { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 5 };
const user = (id: string, role: User['role'] = 'student'): User => ({ id, email: `${id}@example.test`, name: id, passwordHash: null, role, plan: 'basic', verified: true, createdAt: '2026-01-01T00:00:00.000Z', profile, preferences });

test('analytics produces consent-aware anonymous funnels and admin-only platform metrics', async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replica.getUri(); process.env.MONGODB_DATABASE = 'analytics_platform_test'; process.env.DEMO_MODE = 'true'; process.env.ENABLE_ANALYTICS = 'true'; process.env.ANALYTICS_RETENTION_DAYS = '90';
  const store = await import('../src/lib/store.ts'), events = await import('../src/lib/analytics-events.ts'), analytics = await import('../src/lib/analytics-platform.ts'), security = await import('../src/lib/security.ts');
  const admin = user('admin', 'admin'), candidate = user('candidate'), noConsent = user('private-user');
  const now = new Date('2026-06-15T12:00:00.000Z');
  try {
    await store.bootstrapIndexes();
    await store.transaction(async r => {
      await r.put('users', admin); await r.put('users', candidate); await r.put('users', noConsent);
      await r.put('candidateConsents', { id: `${candidate.id}:analytics`, userId: candidate.id, purpose: 'analytics', granted: true, policyVersion: 'analytics-v1', updatedAt: now.toISOString() });
      await r.put('jobs', { id: 'job-published', status: 'published', trust: 'verified', discoveredAt: now.toISOString() });
      await r.put('jobs', { id: 'job-review', status: 'review', trust: 'pending', discoveredAt: now.toISOString() });
      await r.put('applications', { id: 'app-sent', userId: candidate.id, jobId: 'job-published', status: 'SENT', method: 'email', createdAt: now.toISOString() });
      await r.put('applications', { id: 'app-offer', userId: candidate.id, jobId: 'job-review', status: 'OFFER', method: 'direct', createdAt: now.toISOString() });
      await r.put('jobSources', { id: 'source-1', enabled: true });
      await r.put('queueExecutions', { id: 'queue-1', status: 'retry_scheduled' });
      await r.put('deadLetterJobs', { id: 'dead-1', status: 'pending' });
      await events.captureAnalyticsAudit(r, candidate.id, 'account.registered', now);
      await events.captureAnalyticsAudit(r, candidate.id, 'email.verified', now);
      await events.captureAnalyticsAudit(r, candidate.id, 'application.sent', now);
      await events.captureAnalyticsAudit(r, candidate.id, 'auth.login_succeeded', now);
      await events.captureAnalyticsAudit(r, noConsent.id, 'auth.login_succeeded', now);
      await security.audit(r, candidate.id, 'notification.read', 'notification-private-id');
    });
    const report = await analytics.analyticsOverview(admin, new URLSearchParams({ from: '2026-06-01', to: '2026-06-30' }), now);
    assert.equal(report.state, 'active'); assert.equal(report.funnel.registrations, 1); assert.equal(report.funnel.verified, 1); assert.equal(report.funnel.applicationsSent, 1);
    assert.equal(report.events.authenticated_sessions, 1); assert.equal(report.applications.total, 2); assert.equal(report.applications.byStatus.SENT, 1); assert.equal(report.applications.byStatus.OFFER, 1);
    assert.equal(report.jobs.discovered, 2); assert.equal(report.jobs.currentByStatus.published, 1); assert.equal(report.jobs.verified, 1); assert.equal(report.operations.queue.retry_scheduled, 1); assert.equal(report.operations.deadLettersPending, 1);
    await assert.rejects(analytics.analyticsOverview(candidate), { code: 'FORBIDDEN' });
    await assert.rejects(analytics.analyticsOverview(admin, new URLSearchParams({ from: '2024-01-01', to: '2026-06-30' }), now), { code: 'ANALYTICS_RANGE_INVALID' });
    assert.equal((await analytics.recordAnalyticsSnapshot(admin.id, now)).state, 'recorded');
    const persisted = await store.read(async r => ({ rollups: await r.find<Record<string, unknown>>('analyticsRollups', {}, 100), snapshots: await r.find<Record<string, unknown>>('analyticsSnapshots', {}, 10) }));
    const serialized = JSON.stringify(persisted); assert.equal(serialized.includes(candidate.email), false); assert.equal(serialized.includes(candidate.name), false); assert.equal(serialized.includes('notification-private-id'), false); assert.equal(persisted.snapshots.length, 1);
    const indexes = await (await import('mongodb')).MongoClient.connect(replica.getUri()).then(async client => { try { return await client.db('analytics_platform_test').collection('analyticsRollups').indexes(); } finally { await client.close(); } });
    assert.ok(indexes.some(index => index.key?.expiresAtDate === 1 && index.expireAfterSeconds === 0));
  } finally { await store.closeStore(); await replica.stop(); delete process.env.MONGODB_URI; delete process.env.MONGODB_DATABASE; delete process.env.ENABLE_ANALYTICS; delete process.env.ANALYTICS_RETENTION_DAYS; }
});

test('analytics schedule and configuration are credential-free and disabled by default', async () => {
  const events = await import('../src/lib/analytics-events.ts'), queue = await import('../src/lib/queue-infrastructure.ts');
  assert.equal(events.analyticsEnabled({}), false); assert.equal(events.analyticsEnabled({ ENABLE_ANALYTICS: 'true' }), true);
  const schedules = queue.configuredSchedules({ ENABLE_ANALYTICS: 'true', ANALYTICS_ROLLUP_INTERVAL_MS: '600000' } as NodeJS.ProcessEnv);
  assert.deepEqual(schedules.find(item => item.name === 'analytics-rollup'), { id: 'analytics-rollup', name: 'analytics-rollup', every: 600000 });
});
