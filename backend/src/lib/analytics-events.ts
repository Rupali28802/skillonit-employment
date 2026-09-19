import type { User } from './domain.js';
import type { Repository } from './store.js';

export type AnalyticsCategory = 'acquisition' | 'activation' | 'applications' | 'jobs' | 'revenue' | 'engagement' | 'operations';
type MetricDefinition = { metric: string; category: AnalyticsCategory; consent?: boolean };

const exact: Record<string, MetricDefinition> = {
  'account.registered': { metric: 'accounts_registered', category: 'acquisition' },
  'auth.google_registered': { metric: 'accounts_registered_google', category: 'acquisition' },
  'email.verified': { metric: 'accounts_email_verified', category: 'activation' },
  'profile.updated': { metric: 'profiles_updated', category: 'activation' },
  'cv.confirmed': { metric: 'cv_profiles_confirmed', category: 'activation' },
  'ats_cv.confirmed': { metric: 'generated_cvs_confirmed', category: 'activation' },
  'auth.login_succeeded': { metric: 'authenticated_sessions', category: 'engagement', consent: true },
  'auth.google_login': { metric: 'authenticated_sessions_google', category: 'engagement', consent: true },
  'notification.read': { metric: 'notifications_read', category: 'engagement', consent: true },
  'assistant.requested': { metric: 'assistant_requests', category: 'engagement', consent: true },
  'payment.captured': { metric: 'payments_captured', category: 'revenue' },
  'payment.failed': { metric: 'payments_failed', category: 'revenue' },
  'subscription.activated': { metric: 'subscriptions_activated', category: 'revenue' },
  'subscription.expired': { metric: 'subscriptions_expired', category: 'revenue' },
  'source.fetch_succeeded': { metric: 'source_fetch_succeeded', category: 'operations' },
  'source.fetch_failed': { metric: 'source_fetch_failed', category: 'operations' },
  'queue.dead_lettered': { metric: 'queue_dead_lettered', category: 'operations' },
  'notification.delivery_failed': { metric: 'notification_delivery_failed', category: 'operations' },
};

function definition(action: string): MetricDefinition | null {
  if (exact[action]) return exact[action];
  if (action.startsWith('application.')) return { metric: `applications_${action.slice(12).replace(/[^a-z0-9]+/g, '_')}`, category: 'applications' };
  if (action.startsWith('job.') && !action.includes('policy')) return { metric: `jobs_${action.slice(4).replace(/[^a-z0-9]+/g, '_')}`, category: 'jobs' };
  return null;
}

function retentionDays() { return Math.min(1095, Math.max(30, Number(process.env.ANALYTICS_RETENTION_DAYS || 395) || 395)); }
export function analyticsEnabled(env = process.env) { return env.ENABLE_ANALYTICS === 'true'; }

/** Adds an anonymous daily counter inside the caller's existing transaction. */
export async function captureAnalyticsAudit(r: Repository, actorId: string, action: string, now = new Date()) {
  if (!analyticsEnabled()) return;
  const item = definition(action); if (!item) return;
  if (item.consent) {
    const actor = await r.get<User>('users', actorId);
    if (actor) {
      const consent = await r.get<{ granted?: boolean; status?: string }>('candidateConsents', `${actorId}:analytics`);
      if (consent?.granted !== true && consent?.status !== 'granted') return;
    }
  }
  const day = now.toISOString().slice(0, 10), id = `${day}:${item.metric}:v1`;
  const old = await r.get<{ id: string; count: number }>('analyticsRollups', id);
  const expiresAtDate = new Date(`${day}T00:00:00.000Z`); expiresAtDate.setUTCDate(expiresAtDate.getUTCDate() + retentionDays());
  await r.put('analyticsRollups', { id, schemaVersion: 1, day, metric: item.metric, category: item.category, count: (old?.count || 0) + 1, updatedAt: now.toISOString(), expiresAtDate });
}
