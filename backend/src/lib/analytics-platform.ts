import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApplicationStatus, Job, User } from './domain.js';
import type { Repository, Row } from './store.js';
import { read, transaction } from './store.js';
import { analyticsEnabled, type AnalyticsCategory } from './analytics-events.js';
import { ApiError, audit } from './security.js';

type Rollup = Row & { schemaVersion: 1; day: string; metric: string; category: AnalyticsCategory; count: number };
const querySchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }).strict();
const applicationStatuses: ApplicationStatus[] = ['QUEUED', 'NEEDS_REVIEW', 'SENDING', 'SENT', 'EXTERNAL_STARTED', 'EXTERNAL_SUBMITTED', 'DIRECT_SUBMITTED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN', 'CANCELLED', 'FAILED'];
const applicationMethods = ['direct', 'email', 'external'] as const;
const jobStatuses: Job['status'][] = ['draft', 'review', 'published', 'closed', 'disabled'];

async function requireAdmin(r: Repository, actor: User) {
  const current = await r.get<User>('users', actor.id);
  if (!current || current.disabled || current.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
}
function range(params: URLSearchParams, now = new Date()) {
  const input = querySchema.parse(Object.fromEntries(params));
  const to = input.to || now.toISOString().slice(0, 10), start = new Date(`${input.from || to}T00:00:00.000Z`), end = new Date(`${to}T00:00:00.000Z`);
  if (!input.from) start.setUTCDate(start.getUTCDate() - 29);
  if (start > end || end.getTime() - start.getTime() > 366 * 86400000) throw new ApiError(400, 'ANALYTICS_RANGE_INVALID', 'Analytics range must be ordered and no longer than 366 days.');
  const exclusive = new Date(end); exclusive.setUTCDate(exclusive.getUTCDate() + 1);
  return { from: start.toISOString().slice(0, 10), to, fromDate: start.toISOString(), toExclusive: exclusive.toISOString() };
}
async function scanRollups(r: Repository, from: string, to: string) {
  const rows: Rollup[] = []; let after = '';
  while (rows.length < 20_000) { const page = await r.scan<Rollup>('analyticsRollups', { day: { $gte: from, $lt: `${to}\uffff` } }, after, 500); if (!page.length) break; rows.push(...page); after = page.at(-1)!.id; if (page.length < 500) break; }
  return rows;
}
const counts = async (r: Repository, collection: string, field: string, values: readonly string[], query: Record<string, unknown> = {}) => Object.fromEntries(await Promise.all(values.map(async value => [value, await r.count(collection, { ...query, [field]: value })])));

export async function analyticsOverview(actor: User, params = new URLSearchParams(), now = new Date()) {
  const selected = range(params, now);
  return read(async r => {
    await requireAdmin(r, actor);
    const rollups = await scanRollups(r, selected.from, selected.to);
    const events: Record<string, number> = {};
    for (const row of rollups) events[row.metric] = (events[row.metric] ?? 0) + row.count;
    const applicationQuery = { createdAt: { $gte: selected.fromDate, $lt: selected.toExclusive } }, jobQuery = { discoveredAt: { $gte: selected.fromDate, $lt: selected.toExclusive } };
    return {
      schemaVersion: 1, state: analyticsEnabled() ? 'active' : 'disabled', range: { from: selected.from, to: selected.to }, events,
      funnel: { registrations: (events.accounts_registered || 0) + (events.accounts_registered_google || 0), verified: events.accounts_email_verified || 0, profilesUpdated: events.profiles_updated || 0, cvsConfirmed: (events.cv_profiles_confirmed || 0) + (events.generated_cvs_confirmed || 0), applicationsCreated: events.applications_queued || 0, applicationsSent: (events.applications_sent || 0) + (events.applications_direct_submitted || 0) },
      applications: { total: await r.count('applications', applicationQuery), byStatus: await counts(r, 'applications', 'status', applicationStatuses, applicationQuery), byMethod: await counts(r, 'applications', 'method', applicationMethods, applicationQuery) },
      jobs: { discovered: await r.count('jobs', jobQuery), currentByStatus: await counts(r, 'jobs', 'status', jobStatuses), verified: await r.count('jobs', { trust: 'verified' }), activeSources: await r.count('jobSources', { enabled: true }) },
      usage: { users: await r.count('users'), students: await r.count('users', { role: 'student' }), employers: await r.count('users', { role: 'employer' }), activeSubscriptions: await r.count('studentSubscriptions', { status: 'active' }), notifications: await r.count('notifications'), assistantRequests: events.assistant_requests || 0 },
      operations: { queue: await counts(r, 'queueExecutions', 'status', ['processing', 'completed', 'retry_scheduled', 'dead_lettered']), deadLettersPending: await r.count('deadLetterJobs', { status: 'pending' }), ingestionFailures: await r.count('jobIngestionRuns', { status: 'failed' }), sourceFailures: events.source_fetch_failed || 0, notificationFailures: events.notification_delivery_failed || 0 },
    };
  });
}

export async function recordAnalyticsSnapshot(actorId = 'analytics-worker', now = new Date()) {
  if (!analyticsEnabled()) return { state: 'disabled' as const };
  return transaction(async r => {
    const row = { id: randomUUID(), schemaVersion: 1, createdAt: now.toISOString(), users: await r.count('users'), publishedJobs: await r.count('jobs', { status: 'published' }), applications: await r.count('applications'), activeSubscriptions: await r.count('studentSubscriptions', { status: 'active' }), queueBacklog: await r.count('queueExecutions', { status: 'retry_scheduled' }), deadLetters: await r.count('deadLetterJobs', { status: 'pending' }) };
    await r.put('analyticsSnapshots', row); await audit(r, actorId, 'analytics.snapshot_recorded', row.id); return { state: 'recorded' as const, id: row.id };
  });
}
