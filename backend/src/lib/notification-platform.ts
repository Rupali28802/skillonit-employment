import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { User, Role } from './domain.js';
import type { Repository, Row } from './store.js';
import { read, transaction } from './store.js';
import { authMailConfig } from './auth-mail.js';
import { ApiError, audit } from './security.js';

export const notificationTypes = ['job_match', 'application_status', 'billing', 'security', 'profile', 'system'] as const;
export type NotificationType = typeof notificationTypes[number];
export type NotificationChannel = 'in_app' | 'email';
export type DeliveryStatus = 'pending' | 'sending' | 'retry_scheduled' | 'sent' | 'delivered' | 'read' | 'failed' | 'suppressed';

export type NotificationPreferences = {
  id: string; userId: string; inApp: boolean; email: boolean; whatsapp: boolean;
  unsubscribeAll: boolean; types: Partial<Record<NotificationType, boolean>>; updatedAt: string;
};
export type NotificationRecord = {
  id: string; userId: string; type: NotificationType; title: string; message: string; href: string;
  read: boolean; status: 'active' | 'scheduled' | 'cancelled'; createdAt: string; scheduledAt: string;
  dedupeKey?: string; campaignId?: string;
};
export type NotificationDelivery = {
  id: string; notificationId: string; userId: string; channel: NotificationChannel; status: DeliveryStatus;
  attempts: number; maxAttempts: number; nextAttemptAt?: string; leaseUntil?: string; errorCode?: string;
  providerMessageId?: string; createdAt: string; updatedAt: string; deliveredAt?: string;
};

const typeFlags = z.object(Object.fromEntries(notificationTypes.map(type => [type, z.boolean().optional()])) as Record<NotificationType, z.ZodOptional<z.ZodBoolean>>).strict();
export const preferencesSchema = z.object({
  inApp: z.boolean(), email: z.boolean(), whatsapp: z.boolean(), unsubscribeAll: z.boolean().default(false), types: typeFlags.default({}),
}).strict();
const templateSchema = z.object({
  expectedRevision: z.number().int().min(0), enabled: z.boolean(),
  subject: z.string().trim().min(1).max(180), text: z.string().trim().min(1).max(10_000),
}).strict();
const campaignSchema = z.object({
  type: z.enum(notificationTypes), title: z.string().trim().min(1).max(180), message: z.string().trim().min(1).max(4000),
  href: z.string().regex(/^\/(?!\/)[^\s]{0,500}$/),
  audience: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), userId: z.string().min(1).max(100) }).strict(),
    z.object({ kind: z.literal('role'), role: z.enum(['student', 'employer', 'admin']) }).strict(),
  ]),
  scheduledAt: z.iso.datetime().optional(), dedupeKey: z.string().regex(/^[a-zA-Z0-9._:-]{1,150}$/).optional(),
}).strict();

const defaults = (userId: string): NotificationPreferences => ({ id: userId, userId, inApp: true, email: false, whatsapp: false, unsubscribeAll: false, types: {}, updatedAt: new Date(0).toISOString() });
const defaultTemplates: Record<NotificationType, { subject: string; text: string }> = {
  job_match: { subject: 'New SkillOnIT job match', text: '{{message}}\n\nOpen SkillOnIT: {{href}}' },
  application_status: { subject: 'Your SkillOnIT application was updated', text: '{{message}}\n\nOpen SkillOnIT: {{href}}' },
  billing: { subject: 'SkillOnIT billing update', text: '{{message}}\n\nOpen SkillOnIT: {{href}}' },
  security: { subject: 'SkillOnIT security notice', text: '{{message}}\n\nOpen SkillOnIT: {{href}}' },
  profile: { subject: 'SkillOnIT profile update', text: '{{message}}\n\nOpen SkillOnIT: {{href}}' },
  system: { subject: '{{title}}', text: '{{message}}\n\nOpen SkillOnIT: {{href}}' },
};

const maxAttempts = () => Math.min(10, Math.max(1, Number(process.env.NOTIFICATION_MAX_ATTEMPTS || 3) || 3));
const retryBaseSeconds = () => Math.min(3600, Math.max(5, Number(process.env.NOTIFICATION_RETRY_BASE_SECONDS || 30) || 30));
const dailyLimit = () => Math.min(1000, Math.max(1, Number(process.env.NOTIFICATION_USER_DAILY_LIMIT || 100) || 100));

export function notificationEmailConfigured() { try { authMailConfig(); return true; } catch { return false; } }

function enabled(preferences: NotificationPreferences, type: NotificationType, channel: NotificationChannel) {
  if (preferences.unsubscribeAll || preferences.types[type] === false) return false;
  return channel === 'in_app' ? preferences.inApp : preferences.email;
}

async function preferences(r: Repository, userId: string) {
  const stored = await r.get<NotificationPreferences>('notificationPreferences', userId);
  return stored ? { ...defaults(userId), ...stored, types: stored.types || {} } : defaults(userId);
}

async function template(r: Repository, type: NotificationType) {
  const stored = await r.get<{ id: string; enabled: boolean; subject: string; text: string; revision: number }>('notificationTemplates', type);
  return stored || { id: type, enabled: true, ...defaultTemplates[type], revision: 0 };
}

function render(value: string, data: Record<'title' | 'message' | 'href' | 'name', string>) {
  return value.replace(/\{\{(.*?)\}\}/g, (_, key: string) => {
    if (!(key in data)) throw new ApiError(503, 'NOTIFICATION_TEMPLATE_INVALID', 'The notification template requires administrator review.');
    return data[key as keyof typeof data];
  });
}

export async function createNotificationRecord(r: Repository, input: {
  userId: string; type: NotificationType; title: string; message: string; href: string; scheduledAt?: string; dedupeKey?: string; campaignId?: string;
}, now = new Date()) {
  const user = await r.get<User>('users', input.userId);
  if (!user || user.disabled) return null;
  if (input.dedupeKey) {
    const duplicate = (await r.find<NotificationRecord>('notifications', { userId: input.userId, dedupeKey: input.dedupeKey }, 1))[0];
    if (duplicate) return duplicate;
  }
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  if (await r.count('notifications', { userId: input.userId, createdAt: { $gte: dayStart.toISOString() } }) >= dailyLimit()) {
    await audit(r, input.userId, 'notification.rate_limited', input.userId); return null;
  }
  const prefs = await preferences(r, input.userId), scheduledAt = input.scheduledAt || now.toISOString();
  const record: NotificationRecord = { id: randomUUID(), ...input, read: false, status: scheduledAt > now.toISOString() ? 'scheduled' : 'active', createdAt: now.toISOString(), scheduledAt };
  await r.put('notifications', record);
  for (const channel of ['in_app', 'email'] as const) {
    const allowed = enabled(prefs, input.type, channel) && (channel !== 'email' || user.verified);
    const status: DeliveryStatus = !allowed ? 'suppressed' : channel === 'in_app' && record.status === 'active' ? 'delivered' : 'pending';
    await r.put('notificationDeliveries', { id: `${record.id}:${channel}`, notificationId: record.id, userId: user.id, channel, status, attempts: 0, maxAttempts: maxAttempts(), ...(record.status === 'scheduled' ? { nextAttemptAt: scheduledAt } : {}), createdAt: now.toISOString(), updatedAt: now.toISOString(), ...(status === 'delivered' ? { deliveredAt: now.toISOString() } : {}) } satisfies NotificationDelivery);
  }
  await audit(r, input.userId, 'notification.created', record.id);
  return record;
}

export async function createNotification(input: Parameters<typeof createNotificationRecord>[1], now = new Date()) {
  return transaction(r => createNotificationRecord(r, input, now));
}

export async function getNotificationPreferences(user: User) { return read(r => preferences(r, user.id)); }
export async function updateNotificationPreferences(user: User, input: unknown) {
  const value = preferencesSchema.parse(input);
  if (value.email && (!user.verified || !notificationEmailConfigured()))
    throw new ApiError(409, 'CHANNEL_UNAVAILABLE', 'Email notifications require a verified email and configured platform email delivery.');
  if (value.whatsapp) throw new ApiError(409, 'CHANNEL_UNAVAILABLE', 'WhatsApp notifications are not supported.');
  return transaction(async r => {
    const current = await r.get<User>('users', user.id);
    if (!current || current.disabled) throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    const row: NotificationPreferences = { id: user.id, userId: user.id, ...value, updatedAt: new Date().toISOString() };
    await r.put('notificationPreferences', row); await audit(r, user.id, 'notification.preferences_updated', user.id); return row;
  });
}

export async function listNotifications(user: User, limit = 100) {
  return read(async r => {
    const rows = await r.find<NotificationRecord>('notifications', { userId: user.id }, Math.min(200, Math.max(1, limit)));
    const visible: NotificationRecord[] = [];
    for (const row of rows) if ((await r.get<NotificationDelivery>('notificationDeliveries', `${row.id}:in_app`))?.status === 'delivered') visible.push(row);
    return visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}
export async function readNotification(user: User, notificationId: string) {
  return transaction(async r => {
    const row = await r.get<NotificationRecord>('notifications', notificationId);
    if (!row || row.userId !== user.id) throw new ApiError(404, 'NOT_FOUND', 'Notification not found.');
    if (!row.read) await r.put('notifications', { ...row, read: true });
    await audit(r, user.id, 'notification.read', notificationId); return { updated: true };
  });
}

export async function listNotificationTemplates(actor: User) {
  return read(async r => { await requireAdmin(r, actor); return Promise.all(notificationTypes.map(type => template(r, type))); });
}
export async function configureNotificationTemplate(actor: User, type: NotificationType, input: unknown) {
  const value = templateSchema.parse(input);
  for (const field of [value.subject, value.text]) for (const match of field.matchAll(/\{\{(.*?)\}\}/g))
    if (!['title', 'message', 'href', 'name'].includes(match[1])) throw new ApiError(400, 'TEMPLATE_VARIABLE_INVALID', 'The notification template contains an unsupported variable.');
  return transaction(async r => {
    await requireAdmin(r, actor); const current = await template(r, type);
    if (current.revision !== value.expectedRevision) throw new ApiError(409, 'NOTIFICATION_TEMPLATE_CONFLICT', 'Reload the template before saving.');
    const next = { id: type, enabled: value.enabled, subject: value.subject, text: value.text, revision: current.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor.id };
    await r.put('notificationTemplates', next); await audit(r, actor.id, 'notification.template_updated', type); return next;
  });
}

async function requireAdmin(r: Repository, actor: User) {
  const current = await r.get<User>('users', actor.id);
  if (!current || current.disabled || current.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
}

export async function scheduleNotificationCampaign(actor: User, input: unknown, now = new Date()) {
  const value = campaignSchema.parse(input), scheduledAt = value.scheduledAt || now.toISOString();
  if (scheduledAt < new Date(now.getTime() - 60_000).toISOString()) throw new ApiError(400, 'SCHEDULE_INVALID', 'Notification schedule cannot be in the past.');
  return transaction(async r => {
    await requireAdmin(r, actor);
    const campaign = { id: randomUUID(), ...value, scheduledAt, status: scheduledAt > now.toISOString() ? 'scheduled' : 'processing', createdAt: now.toISOString(), createdBy: actor.id };
    await r.put('notificationCampaigns', campaign); await audit(r, actor.id, 'notification.campaign_scheduled', campaign.id);
    return campaign;
  });
}

export async function processNotificationCampaigns(now = new Date(), limit = 20) {
  const campaigns = await read(r => r.find<Row>('notificationCampaigns', {}, 200)); let processed = 0, created = 0;
  for (const campaign of campaigns.filter(row => ['scheduled', 'processing'].includes(String(row.status)) && String(row.scheduledAt) <= now.toISOString()).slice(0, limit)) {
    const outcome = await transaction(async r => {
      const current = await r.get<Row>('notificationCampaigns', campaign.id); if (!current || !['scheduled', 'processing'].includes(String(current.status))) return;
      const audience = current.audience as { kind: 'user'; userId: string } | { kind: 'role'; role: Role };
      const users = audience.kind === 'user' ? [await r.get<User>('users', audience.userId)].filter((u): u is User => !!u) : await r.find<User>('users', { role: audience.role }, 1000);
      let count = 0;
      for (const user of users) if (await createNotificationRecord(r, { userId: user.id, type: current.type as NotificationType, title: String(current.title), message: String(current.message), href: String(current.href), campaignId: current.id, dedupeKey: current.dedupeKey ? `${current.dedupeKey}:${user.id}` : undefined }, now)) count++;
      await r.put('notificationCampaigns', { ...current, status: 'completed', completedAt: now.toISOString(), recipientCount: users.length }); return count;
    });
    if (outcome !== undefined) { processed++; created += outcome; }
  }
  return { processed, created };
}

export interface NotificationEmailProvider { send(input: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<{ messageId?: string }> }
export class SmtpNotificationEmailProvider implements NotificationEmailProvider {
  async send(input: { to: string; subject: string; text: string; idempotencyKey: string }) {
    const config = authMailConfig();
    const transport = nodemailer.createTransport({ host: config.SMTP_HOST, port: Number(config.SMTP_PORT), secure: config.SMTP_PORT === '465', requireTLS: true, auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
    try {
      const result = await transport.sendMail({ from: config.AUTH_EMAIL_FROM, to: input.to, subject: input.subject, text: input.text, headers: { 'X-SkillOnIT-Idempotency-Key': input.idempotencyKey } });
      if (!result.accepted.length) throw new Error('not accepted'); return { messageId: result.messageId ? String(result.messageId) : undefined };
    } catch { throw new ApiError(503, 'NOTIFICATION_EMAIL_FAILED', 'Notification email delivery failed.'); }
  }
}

export async function dispatchNotificationEmails(provider: NotificationEmailProvider = new SmtpNotificationEmailProvider(), now = new Date(), limit = 100) {
  const candidates = (await read(r => r.find<NotificationDelivery>('notificationDeliveries', {}, 1000))).filter(row => row.channel === 'email' && ['pending', 'retry_scheduled'].includes(row.status) && (!row.nextAttemptAt || row.nextAttemptAt <= now.toISOString())).slice(0, limit);
  let delivered = 0, retried = 0, failed = 0;
  for (const candidate of candidates) {
    const claimed = await transaction(async r => {
      const row = await r.get<NotificationDelivery>('notificationDeliveries', candidate.id);
      if (!row || !['pending', 'retry_scheduled'].includes(row.status) || (row.nextAttemptAt && row.nextAttemptAt > now.toISOString())) return null;
      const next = { ...row, status: 'sending' as const, attempts: row.attempts + 1, leaseUntil: new Date(now.getTime() + 60_000).toISOString(), updatedAt: now.toISOString() };
      await r.put('notificationDeliveries', next); return next;
    });
    if (!claimed) continue;
    try {
      const context = await read(async r => ({ notification: await r.get<NotificationRecord>('notifications', claimed.notificationId), user: await r.get<User>('users', claimed.userId), template: undefined as Awaited<ReturnType<typeof template>> | undefined, prefs: await preferences(r, claimed.userId) }));
      if (!context.notification || !context.user || context.user.disabled || !context.user.verified || !enabled(context.prefs, context.notification.type, 'email')) throw new ApiError(409, 'NOTIFICATION_SUPPRESSED', 'Notification delivery is no longer permitted.');
      context.template = await read(r => template(r, context.notification!.type));
      if (!context.template.enabled) throw new ApiError(409, 'NOTIFICATION_SUPPRESSED', 'Notification template is disabled.');
      const data = { title: context.notification.title, message: context.notification.message, href: context.notification.href, name: context.user.name };
      const sent = await provider.send({ to: context.user.email, subject: render(context.template.subject, data), text: render(context.template.text, data), idempotencyKey: claimed.id });
      await transaction(async r => { const row = await r.get<NotificationDelivery>('notificationDeliveries', claimed.id); if (row?.status !== 'sending') return; await r.put('notificationDeliveries', { ...row, status: 'delivered', leaseUntil: undefined, nextAttemptAt: undefined, errorCode: undefined, providerMessageId: sent.messageId, deliveredAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); await audit(r, claimed.userId, 'notification.email_delivered', claimed.notificationId); }); delivered++;
    } catch (error) {
      const suppressed = error instanceof ApiError && error.code === 'NOTIFICATION_SUPPRESSED';
      await transaction(async r => { const row = await r.get<NotificationDelivery>('notificationDeliveries', claimed.id); if (row?.status !== 'sending') return; const terminal = suppressed || row.attempts >= row.maxAttempts; await r.put('notificationDeliveries', { ...row, status: suppressed ? 'suppressed' : terminal ? 'failed' : 'retry_scheduled', leaseUntil: undefined, errorCode: suppressed ? 'PREFERENCE_SUPPRESSED' : 'NOTIFICATION_EMAIL_FAILED', nextAttemptAt: terminal ? undefined : new Date(now.getTime() + retryBaseSeconds() * 1000 * 2 ** Math.max(0, row.attempts - 1)).toISOString(), updatedAt: new Date().toISOString() }); await audit(r, claimed.userId, suppressed ? 'notification.suppressed' : terminal ? 'notification.delivery_failed' : 'notification.retry_scheduled', claimed.notificationId); });
      if (suppressed) failed++; else if (claimed.attempts >= claimed.maxAttempts) failed++; else retried++;
    }
  }
  return { claimed: candidates.length, delivered, retried, failed };
}

export async function notificationDeliveryStatus(user: User, notificationId: string) {
  return read(async r => {
    const notification = await r.get<NotificationRecord>('notifications', notificationId);
    if (!notification || notification.userId !== user.id) throw new ApiError(404, 'NOT_FOUND', 'Notification not found.');
    const rows = await r.find<NotificationDelivery>('notificationDeliveries', { notificationId }, 5);
    return rows.map(({ providerMessageId: _provider, leaseUntil: _lease, ...row }) => row);
  });
}
