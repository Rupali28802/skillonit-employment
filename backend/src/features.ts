import { z } from 'zod';
import {
  read,
  transaction,
  configuredPlans,
  type Repository,
  type Row,
} from './lib/store.js';
import { requireUser, ApiError, audit, id } from './lib/security.js';
import { profileSchema } from './lib/schemas.js';
import { searchJobs } from './lib/search.js';
import { publicJob, isRecent, type Job, type User } from './lib/domain.js';
import {
  createJobSource,
  fetchJobSource,
  listJobSources,
  sourceEvents,
  updateJobSource,
} from './lib/job-source-strategy.js';
import {
  configureDiscoveryPolicy,
  discoveryOverview,
  runDiscovery,
} from './lib/job-discovery.js';
import { configureIngestionPolicy, ingestionOverview, runIngestion } from './lib/job-ingestion.js';
import { configureFraudPolicy, fraudOverview, recheckFraud } from './lib/fraud-detection.js';
import { configureDeduplicationPolicy, deduplicationOverview } from './lib/job-deduplication.js';
import { configureLifecyclePolicy, expireJobs, lifecycleOverview } from './lib/lifecycle.js';
import { getStudentSubscription, resolveStudentEntitlements } from './lib/student-entitlements.js';
import { configureNotificationTemplate, createNotificationRecord, getNotificationPreferences, listNotifications, listNotificationTemplates, notificationDeliveryStatus, notificationTypes, processNotificationCampaigns, readNotification, scheduleNotificationCampaign, updateNotificationPreferences } from './lib/notification-platform.js';
import { queueOverview } from './lib/queue-infrastructure.js';
import { runAssistant } from './lib/ai-assistant.js';
import { analyticsOverview, recordAnalyticsSnapshot } from './lib/analytics-platform.js';
import { observabilityOverview } from './lib/observability.js';

const searchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  query: z.string().trim().max(200),
  country: z.string().max(100).default(''),
  mode: z.enum(['', 'Remote', 'Hybrid', 'On-site']).default(''),
  enabled: z.boolean().default(true),
});
const flagDefaults = { assistant: true, savedSearchAlerts: true };
async function requireFeature(key: keyof typeof flagDefaults) {
  const config = await read((r) =>
    r.get<{ value: typeof flagDefaults }>('systemConfig', 'feature-flags'),
  );
  if ((config?.value || flagDefaults)[key] === false)
    throw new ApiError(
      503,
      'FEATURE_PAUSED',
      'This feature is temporarily paused. Please try again later.',
    );
}
export async function notify(
  r: Repository,
  userId: string,
  title: string,
  message: string,
  href: string,
  type: 'job_match' | 'application_status' | 'billing' | 'security' | 'profile' | 'system' = 'system',
) {
  return createNotificationRecord(r, { userId, type, title, message, href });
}

async function owned(
  r: Repository,
  collection: string,
  recordId: string,
  userId: string,
) {
  const row = await r.get<Row>(collection, recordId);
  if (!row || row.userId !== userId)
    throw new ApiError(404, 'NOT_FOUND', 'Record not found.');
  return row;
}

/** Optional feature routes share the same request context and error boundary as the core API. */
export async function featureRoute(
  p: string,
  method: string,
  body: () => Promise<unknown>,
  params = new URLSearchParams(),
): Promise<{ data: unknown; status?: number } | undefined> {
  const parts = p.split('/');
  if (p === 'admin/queue/status' && method === 'GET') {
    const user = await requireUser('admin'); return { data: await queueOverview(user) };
  }
  if (p === 'admin/observability' && method === 'GET') {
    const user = await requireUser('admin'); return { data: await observabilityOverview(user) };
  }
  if (p === 'admin/analytics' && method === 'GET') {
    const user = await requireUser('admin'); return { data: await analyticsOverview(user, params) };
  }
  if (p === 'admin/analytics/rollup' && method === 'POST') {
    const user = await requireUser('admin'); return { data: await recordAnalyticsSnapshot(user.id) };
  }
  if (p === 'admin/notification-templates' && method === 'GET') {
    const user = await requireUser('admin'); return { data: await listNotificationTemplates(user) };
  }
  if (parts[0] === 'admin' && parts[1] === 'notification-templates' && parts.length === 3 && method === 'PUT') {
    const user = await requireUser('admin');
    const type = z.enum(notificationTypes).parse(parts[2]);
    return { data: await configureNotificationTemplate(user, type, await body()) };
  }
  if (p === 'admin/notifications' && method === 'POST') {
    const user = await requireUser('admin'); return { data: await scheduleNotificationCampaign(user, await body()), status: 201 };
  }
  if (p === 'admin/notifications/dispatch' && method === 'POST') {
    await requireUser('admin');
    const campaigns = await processNotificationCampaigns();
    return { data: { campaigns } };
  }
  if (p === 'admin/job-lifecycle/status' && method === 'GET') {
    await requireUser('admin');
    return { data: await lifecycleOverview() };
  }
  if (p === 'admin/job-lifecycle/config' && method === 'PUT') {
    const user = await requireUser('admin');
    return { data: await configureLifecyclePolicy(user, await body()) };
  }
  if (p === 'admin/job-lifecycle/run' && method === 'POST') {
    await requireUser('admin');
    return { data: { expired: await expireJobs() } };
  }
  if (p === 'admin/deduplication/status' && method === 'GET') {
    await requireUser('admin');
    return { data: await deduplicationOverview() };
  }
  if (p === 'admin/deduplication/config' && method === 'PUT') {
    const user = await requireUser('admin');
    return { data: await configureDeduplicationPolicy(user, await body()) };
  }
  if (p === 'admin/fraud/status' && method === 'GET') {
    await requireUser('admin');
    return { data: await fraudOverview() };
  }
  if (p === 'admin/fraud/config' && method === 'PUT') {
    const user = await requireUser('admin');
    return { data: await configureFraudPolicy(user, await body()) };
  }
  if (p === 'admin/fraud/recheck' && method === 'POST') {
    const user = await requireUser('admin');
    return { data: await recheckFraud(user.id, await body()) };
  }
  if (p === 'admin/ingestion/status' && method === 'GET') {
    await requireUser('admin');
    return { data: await ingestionOverview() };
  }
  if (p === 'admin/ingestion/config' && method === 'PUT') {
    const user = await requireUser('admin');
    return { data: await configureIngestionPolicy(user.id, await body()) };
  }
  if (p === 'admin/ingestion/run' && method === 'POST') {
    const user = await requireUser('admin');
    return { data: await runIngestion(user.id) };
  }
  if (p === 'admin/discovery/status' && method === 'GET') {
    await requireUser('admin');
    return { data: await discoveryOverview() };
  }
  if (p === 'admin/discovery/config' && method === 'PUT') {
    const user = await requireUser('admin');
    return { data: await configureDiscoveryPolicy(user.id, await body()) };
  }
  if (p === 'admin/discovery/run' && method === 'POST') {
    const user = await requireUser('admin');
    return { data: await runDiscovery('manual', user.id, await body()) };
  }
  if (p === 'admin/sources') {
    const user = await requireUser('admin');
    if (method === 'GET') return { data: await listJobSources() };
    if (method === 'POST') return { data: await createJobSource(user.id, await body()), status: 201 };
  }
  if (parts[0] === 'admin' && parts[1] === 'sources' && parts.length === 3 && method === 'PATCH') {
    const user = await requireUser('admin');
    return { data: await updateJobSource(user.id, parts[2], await body()) };
  }
  if (parts[0] === 'admin' && parts[1] === 'sources' && parts[3] === 'events' && parts.length === 4 && method === 'GET') {
    await requireUser('admin');
    return { data: await sourceEvents(parts[2]) };
  }
  if (parts[0] === 'admin' && parts[1] === 'sources' && parts[3] === 'run' && parts.length === 4 && method === 'POST') {
    const user = await requireUser('admin');
    return { data: await fetchJobSource(parts[2], id(), user.id) };
  }
  if (parts[0] === 'applications' && parts.length === 2 && method === 'GET') {
    const user = await requireUser('student');
    return {
      data: await read((r) => owned(r, 'applications', parts[1], user.id)),
    };
  }
  if (p === 'me/saved-searches') {
    const user = await requireUser('student');
    if (method === 'GET')
      return {
        data: await read((r) =>
          r.find('savedSearches', { userId: user.id }, 100),
        ),
      };
    if (method === 'POST') {
      const input = searchSchema.parse(await body());
      const record = {
        id: id(),
        userId: user.id,
        ...input,
        createdAt: new Date().toISOString(),
      };
      await transaction(async (r) => {
        if (
          (await r.find('savedSearches', { userId: user.id }, 100)).length >= 50
        )
          throw new ApiError(
            409,
            'LIMIT_REACHED',
            'You can save up to 50 searches.',
          );
        await r.put('savedSearches', record);
        await audit(r, user.id, 'search.saved', record.id);
      });
      return { data: record, status: 201 };
    }
  }
  if (
    parts[0] === 'me' &&
    parts[1] === 'saved-searches' &&
    parts.length === 3
  ) {
    const user = await requireUser('student');
    if (method === 'DELETE' || method === 'PATCH') {
      const input =
        method === 'PATCH'
          ? z.object({ enabled: z.boolean() }).parse(await body())
          : null;
      await transaction(async (r) => {
        const record = await owned(r, 'savedSearches', parts[2], user.id);
        if (input) await r.put('savedSearches', { ...record, ...input });
        else await r.remove('savedSearches', record.id);
        await audit(
          r,
          user.id,
          input ? 'search.updated' : 'search.removed',
          record.id,
        );
      });
      return { data: { updated: true } };
    }
  }
  if (p === 'me/notifications') {
    const user = await requireUser();
    if (method === 'GET') return { data: await listNotifications(user, 200) };
    if (method === 'PATCH') {
      const input = z
        .object({ id: z.string().min(1).max(100) })
        .parse(await body());
      return { data: await readNotification(user, input.id) };
    }
  }
  if (parts[0] === 'me' && parts[1] === 'notifications' && parts[3] === 'delivery' && parts.length === 4 && method === 'GET') {
    const user = await requireUser(); return { data: await notificationDeliveryStatus(user, parts[2]) };
  }
  if (p === 'me/notification-preferences') {
    const user = await requireUser();
    if (method === 'GET') return { data: await getNotificationPreferences(user) };
    if (method === 'PUT') {
      return { data: await updateNotificationPreferences(user, await body()) };
    }
  }
  if (p === 'me/cv-versions') {
    const user = await requireUser('student');
    if (method === 'GET')
      return {
        data: await read((r) => r.find('cvVersions', { userId: user.id }, 30)),
      };
    if (method === 'POST') {
      const input = z
        .object({
          name: z.string().trim().min(1).max(100),
          targetRole: z.string().trim().max(100),
          summary: z.string().trim().min(20).max(6000),
          profile: profileSchema,
          confirmed: z.literal(true),
        })
        .parse(await body());
      if (!input.profile.confirmed)
        throw new ApiError(
          409,
          'CONFIRMATION_REQUIRED',
          'Confirm your profile before creating a CV version.',
        );
      const plans = await configuredPlans();
      const version = {
        id: id(),
        userId: user.id,
        ...input,
        source: 'candidate-authored',
        createdAt: new Date().toISOString(),
      };
      await transaction(async (r) => {
        const latest = await r.get<User>('users', user.id);
        if (!latest || latest.disabled || latest.role !== 'student') throw new ApiError(403, 'FORBIDDEN', 'A student account is required.');
        const limit = (await resolveStudentEntitlements(r, latest, plans)).limits.cvVersions;
        if (
          (await r.find('cvVersions', { userId: user.id }, 30)).length >=
          limit
        )
          throw new ApiError(
            409,
            'ENTITLEMENT_REQUIRED',
            `Your active entitlement allows ${limit} CV versions.`,
          );
        await r.put('users', { ...latest, cvQuotaRevision: (latest.cvQuotaRevision ?? 0) + 1 });
        await r.put('cvVersions', version);
        await notify(
          r,
          user.id,
          'CV version saved',
          'Your confirmed CV version is ready to review and download.',
          '/cvs',
          'profile',
        );
        await audit(r, user.id, 'cv.version_created', version.id);
      });
      return { data: version, status: 201 };
    }
  }
  if (parts[0] === 'me' && parts[1] === 'cv-versions' && parts.length === 3) {
    const user = await requireUser('student');
    if (method === 'GET')
      return {
        data: await read((r) => owned(r, 'cvVersions', parts[2], user.id)),
      };
    if (method === 'DELETE') {
      await transaction(async (r) => {
        const version = await owned(r, 'cvVersions', parts[2], user.id);
        if (typeof version.documentId === 'string') { const doc = await r.get<Row>('cvDocuments', version.documentId); if (doc?.activeVersionId === parts[2]) await r.put('cvDocuments', { ...doc, activeVersionId: null }); }
        await r.remove('cvVersions', parts[2]);
        const latest = await r.get<User>('users', user.id);
        if (latest?.activeCvVersionId === parts[2]) await r.put('users', { ...latest, activeCvVersionId: null });
        await audit(r, user.id, 'cv.version_deleted', parts[2]);
      });
      return { data: { deleted: true } };
    }
  }
  if (p === 'me/template-history' && method === 'GET') {
    const user = await requireUser('student');
    return {
      data: (
        await read((r) =>
          r.find<Row>('templateVersions', { userId: user.id }, 100),
        )
      ).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    };
  }
  if (p === 'me/usage' && method === 'GET') {
    const user = await requireUser('student');
    return { data: await getStudentSubscription(user.id) };
  }
  if (
    parts[0] === 'jobs' &&
    parts[2] === 'save' &&
    parts.length === 3 &&
    method === 'DELETE'
  ) {
    const user = await requireUser('student');
    await transaction((r) => r.remove('savedJobs', `${user.id}:${parts[1]}`));
    return { data: { saved: false } };
  }
  if (p === 'assistant' && method === 'POST') {
    const user = await requireUser();
    await requireFeature('assistant');
    return { data: await runAssistant(user, await body()) };
  }
  if (p === 'admin/configuration') {
    const user = await requireUser('admin');
    if (method === 'GET')
      return {
        data: (await read((r) => r.get('systemConfig', 'public-content'))) || {
          id: 'public-content',
          email: 'skillonitemployment@gmail.com',
          phone: '',
          announcement: '',
        },
      };
    if (method === 'PUT') {
      const input = z
        .object({
          email: z.email(),
          phone: z.string().max(40),
          announcement: z.string().max(300),
        })
        .parse(await body());
      await transaction(async (r) => {
        await r.put('systemConfig', { id: 'public-content', ...input });
        await audit(r, user.id, 'content.updated', 'public-content');
      });
      return { data: input };
    }
  }
  if (p === 'admin/feature-flags') {
    const user = await requireUser('admin');
    if (method === 'GET')
      return {
        data:
          (
            await read((r) =>
              r.get<{ value: typeof flagDefaults }>(
                'systemConfig',
                'feature-flags',
              ),
            )
          )?.value || flagDefaults,
      };
    if (method === 'PUT') {
      const value = z
        .object({ assistant: z.boolean(), savedSearchAlerts: z.boolean() })
        .parse(await body());
      await transaction(async (r) => {
        await r.put('systemConfig', { id: 'feature-flags', value });
        await audit(r, user.id, 'feature_flags.updated', 'feature-flags');
      });
      return { data: value };
    }
  }
  if (p === 'admin/source-policies') {
    const user = await requireUser('admin');
    if (method === 'GET') return { data: await listJobSources() };
    if (method === 'POST') {
      const input = z
        .object({
          name: z.string().trim().min(1).max(100),
          board: z.string().regex(/^[a-z0-9_-]{1,80}$/i),
          policyEvidence: z.string().trim().min(20).max(2000),
          requestsPerMinute: z.number().int().min(1).max(10),
          approved: z.boolean(),
          enabled: z.boolean(),
        })
        .parse(await body());
      if (input.enabled && !input.approved)
        throw new ApiError(
          409,
          'APPROVAL_REQUIRED',
          'Approve and document the source policy before enabling it.',
        );
      return {
        data: await createJobSource(user.id, {
          name: input.name, provider: 'greenhouse', configuration: { board: input.board },
          enabled: input.enabled,
          compliance: {
            status: input.approved ? 'approved' : 'pending', policyEvidence: input.policyEvidence,
            permittedMethod: 'official_api', jurisdictions: [],
          },
          schedule: { intervalMinutes: 60 }, rate: { requestsPerMinute: input.requestsPerMinute },
          retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 3600 },
        }),
        status: 201,
      };
    }
  }
  if (p === 'public/configuration' && method === 'GET') {
    const content = await read((r) =>
      r.get<Row>('systemConfig', 'public-content'),
    );
    return {
      data: {
        email: content?.email || 'skillonitemployment@gmail.com',
        phone: content?.phone || '',
        announcement: content?.announcement || '',
      },
    };
  }
  if (
    parts[0] === 'admin' &&
    parts[1] === 'leads' &&
    parts[3] === 'notes' &&
    parts.length === 4 &&
    method === 'POST'
  ) {
    const user = await requireUser('admin');
    const input = z
      .object({
        note: z.string().trim().min(1).max(2000),
        assignedTo: z.string().trim().max(100),
      })
      .parse(await body());
    await transaction(async (r) => {
      const lead = await r.get<Row>('leads', parts[2]);
      if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead not found.');
      await r.put('leads', { ...lead, assignedTo: input.assignedTo });
      await r.put('leadNotes', {
        id: id(),
        leadId: lead.id,
        ...input,
        actorId: user.id,
        createdAt: new Date().toISOString(),
      });
      await audit(r, user.id, 'lead.note_added', lead.id);
    });
    return { data: { updated: true }, status: 201 };
  }
  if (p === 'me/alerts/refresh' && method === 'POST') {
    const user = await requireUser('student');
    await requireFeature('savedSearchAlerts');
    const searches = await read((r) =>
      r.find<Row>('savedSearches', { userId: user.id, enabled: true }, 50),
    );
    const plans = await configuredPlans();
    let created = 0;
    for (const search of searches) {
      const result = await searchJobs(
        new URLSearchParams({
          q: String(search.query),
          country: String(search.country),
          mode: String(search.mode),
        }),
        user,
      );
      created += await transaction(async (r) => {
        let added = 0;
        for (const resultJob of result.jobs) {
          const alertId = `${user.id}:${search.id}:${resultJob.id}`;
          if (await r.get('searchAlerts', alertId)) continue;
          const job = await r.get<Job>('jobs', resultJob.id);
          if (!job || job.status !== 'published' || !isRecent(job)) continue;
          const safe = publicJob(job, user, plans);
          await notify(
            r,
            user.id,
            `New match: ${search.name}`,
            safe.title,
            `/jobs/${encodeURIComponent(job.id)}`,
            'job_match',
          );
          await r.put('searchAlerts', {
            id: alertId,
            userId: user.id,
            searchId: search.id,
            jobId: job.id,
          });
          added++;
        }
        return added;
      });
    }
    return {
      data: {
        created,
        message: `${created} new matches checked. View enabled in-app notifications for updates.`,
      },
    };
  }
  return undefined;
}
