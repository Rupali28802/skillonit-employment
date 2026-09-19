import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { User } from '../src/lib/domain.ts';

const profile = { name: '', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false };
const preferences = { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 5 };
const user = (id: string, role: User['role'] = 'student'): User => ({ id, email: `${id}@example.test`, name: id, passwordHash: null, role, plan: 'basic', verified: true, createdAt: '2026-01-01T00:00:00.000Z', profile, preferences });

test('notification platform enforces preferences, templates, scheduling, retries, ownership and audit safety', async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replica.getUri(); process.env.MONGODB_DATABASE = 'notification_platform_test'; process.env.DEMO_MODE = 'true';
  const emailEnv = { ENABLE_AUTH_EMAIL: process.env.ENABLE_AUTH_EMAIL, SMTP_HOST: process.env.SMTP_HOST, SMTP_PORT: process.env.SMTP_PORT, SMTP_USER: process.env.SMTP_USER, SMTP_PASSWORD: process.env.SMTP_PASSWORD, AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM, APP_URL: process.env.APP_URL };
  Object.assign(process.env, { ENABLE_AUTH_EMAIL: 'true', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_USER: 'test-user', SMTP_PASSWORD: 'test-secret', AUTH_EMAIL_FROM: 'notify@example.test', APP_URL: 'https://app.example.test/' });
  const store = await import('../src/lib/store.ts'); const platform = await import('../src/lib/notification-platform.ts');
  const admin = user('admin', 'admin'), candidate = user('candidate'), other = user('other');
  try {
    await store.bootstrapIndexes(); await store.transaction(async r => { await r.put('users', admin); await r.put('users', candidate); await r.put('users', other); });
    const prefs = await platform.updateNotificationPreferences(candidate, { inApp: true, email: true, whatsapp: false, unsubscribeAll: false, types: { billing: false } });
    assert.equal(prefs.email, true);
    const notification = await platform.createNotification({ userId: candidate.id, type: 'job_match', title: 'New match', message: 'Backend Engineer', href: '/jobs/job-one', dedupeKey: 'match:job-one' }, new Date('2026-02-01T00:00:00.000Z'));
    assert.ok(notification); assert.equal((await platform.listNotifications(candidate))[0].type, 'job_match');
    const duplicate = await platform.createNotification({ userId: candidate.id, type: 'job_match', title: 'Duplicate', message: 'Duplicate', href: '/jobs/job-one', dedupeKey: 'match:job-one' }, new Date('2026-02-01T00:01:00.000Z'));
    assert.equal(duplicate?.id, notification?.id);
    const statuses = await platform.notificationDeliveryStatus(candidate, notification!.id);
    assert.equal(statuses.find(row => row.channel === 'in_app')?.status, 'delivered');
    assert.equal(statuses.find(row => row.channel === 'email')?.status, 'pending');
    await assert.rejects(platform.notificationDeliveryStatus(other, notification!.id), { code: 'NOT_FOUND' });
    await platform.readNotification(candidate, notification!.id); assert.equal((await platform.listNotifications(candidate))[0].read, true);

    const template = await platform.configureNotificationTemplate(admin, 'job_match', { expectedRevision: 0, enabled: true, subject: 'SkillOnIT: {{title}}', text: 'Hello {{name}}\n{{message}}\n{{href}}' });
    assert.equal(template.revision, 1);
    await assert.rejects(platform.configureNotificationTemplate(admin, 'job_match', { expectedRevision: 0, enabled: true, subject: '{{secret}}', text: 'Invalid' }), { code: 'TEMPLATE_VARIABLE_INVALID' });

    let attempts = 0;
    const provider: platform.NotificationEmailProvider = { async send(input) { attempts++; assert.equal(input.to, candidate.email); assert.equal(input.subject, 'SkillOnIT: New match'); if (attempts === 1) throw Error('private provider detail'); return { messageId: 'provider-message-id' }; } };
    const first = await platform.dispatchNotificationEmails(provider, new Date('2026-02-01T00:00:01.000Z')); assert.deepEqual(first, { claimed: 1, delivered: 0, retried: 1, failed: 0 });
    const retry = await platform.dispatchNotificationEmails(provider, new Date('2026-02-01T00:00:32.000Z')); assert.deepEqual(retry, { claimed: 1, delivered: 1, retried: 0, failed: 0 });
    assert.equal((await platform.notificationDeliveryStatus(candidate, notification!.id)).find(row => row.channel === 'email')?.status, 'delivered');

    const campaign = await platform.scheduleNotificationCampaign(admin, { type: 'system', title: 'Maintenance', message: 'Service maintenance completed.', href: '/', audience: { kind: 'role', role: 'student' }, scheduledAt: '2026-02-02T00:00:00.000Z', dedupeKey: 'maintenance-1' }, new Date('2026-02-01T00:00:00.000Z'));
    assert.equal(campaign.status, 'scheduled'); assert.deepEqual(await platform.processNotificationCampaigns(new Date('2026-02-01T12:00:00.000Z')), { processed: 0, created: 0 });
    assert.deepEqual(await platform.processNotificationCampaigns(new Date('2026-02-02T00:00:00.000Z')), { processed: 1, created: 2 });

    const billing = await platform.createNotification({ userId: candidate.id, type: 'billing', title: 'Billing', message: 'Receipt available.', href: '/billing' }, new Date('2026-02-03T00:00:00.000Z'));
    const billingStatuses = await platform.notificationDeliveryStatus(candidate, billing!.id);
    assert.ok(billingStatuses.every(row => row.status === 'suppressed'));
    const audits = await store.read(r => r.find<Record<string, unknown>>('auditLogs', {}, 100));
    assert.ok(audits.some(row => row.action === 'notification.email_delivered'));
    assert.equal(JSON.stringify(audits).includes('Backend Engineer'), false);
    assert.equal(JSON.stringify(audits).includes('provider-message-id'), false);
  } finally {
    await store.closeStore(); await replica.stop(); delete process.env.MONGODB_URI; delete process.env.MONGODB_DATABASE;
    for (const [key, value] of Object.entries(emailEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('notification email preference fails closed without a trusted configured provider', async () => {
  const previous = process.env.ENABLE_AUTH_EMAIL; delete process.env.ENABLE_AUTH_EMAIL;
  const platform = await import('../src/lib/notification-platform.ts');
  try { await assert.rejects(platform.updateNotificationPreferences(user('offline'), { inApp: true, email: true, whatsapp: false }), { code: 'CHANNEL_UNAVAILABLE' }); }
  finally { previous === undefined ? delete process.env.ENABLE_AUTH_EMAIL : process.env.ENABLE_AUTH_EMAIL = previous; }
});
