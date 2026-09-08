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
import { publicJob, isRecent, type Job } from './lib/domain.js';

const searchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  query: z.string().trim().max(200),
  country: z.string().max(100).default(''),
  mode: z.enum(['', 'Remote', 'Hybrid', 'On-site']).default(''),
  enabled: z.boolean().default(true),
});
const notificationDefaults = { inApp: true, email: false, whatsapp: false };
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
) {
  const preferences = await r.get<typeof notificationDefaults>(
    'notificationPreferences',
    userId,
  );
  if (preferences?.inApp === false) return;
  await r.put('notifications', {
    id: id(),
    userId,
    title,
    message,
    href,
    read: false,
    createdAt: new Date().toISOString(),
  });
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
): Promise<{ data: unknown; status?: number } | undefined> {
  const parts = p.split('/');
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
    if (method === 'GET')
      return {
        data: (
          await read((r) =>
            r.find<Row>('notifications', { userId: user.id }, 200),
          )
        ).sort((a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt)),
        ),
      };
    if (method === 'PATCH') {
      const input = z
        .object({ id: z.string().min(1).max(100) })
        .parse(await body());
      await transaction(async (r) => {
        const item = await owned(r, 'notifications', input.id, user.id);
        await r.put('notifications', { ...item, read: true });
      });
      return { data: { updated: true } };
    }
  }
  if (p === 'me/notification-preferences') {
    const user = await requireUser();
    if (method === 'GET')
      return {
        data:
          (await read((r) => r.get('notificationPreferences', user.id))) ||
          notificationDefaults,
      };
    if (method === 'PUT') {
      const input = z
        .object({
          inApp: z.boolean(),
          email: z.boolean(),
          whatsapp: z.boolean(),
        })
        .parse(await body());
      if (input.email || input.whatsapp)
        throw new ApiError(
          409,
          'CHANNEL_UNAVAILABLE',
          'Email and WhatsApp delivery are not connected. In-app notifications are available.',
        );
      await transaction(async (r) => {
        await r.put('notificationPreferences', {
          id: user.id,
          userId: user.id,
          ...input,
          updatedAt: new Date().toISOString(),
        });
        await audit(r, user.id, 'notification_preferences.updated', user.id);
      });
      return { data: input };
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
      const plan = (await configuredPlans()).find(
        (plan) => plan.code === user.plan,
      )!;
      const version = {
        id: id(),
        userId: user.id,
        ...input,
        source: 'candidate-authored',
        createdAt: new Date().toISOString(),
      };
      await transaction(async (r) => {
        if (
          (await r.find('cvVersions', { userId: user.id }, 30)).length >=
          plan.cvs
        )
          throw new ApiError(
            409,
            'ENTITLEMENT_REQUIRED',
            `Your plan allows ${plan.cvs} CV versions.`,
          );
        await r.put('cvVersions', version);
        await notify(
          r,
          user.id,
          'CV version saved',
          'Your confirmed CV version is ready to review and download.',
          '/cvs',
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
        await owned(r, 'cvVersions', parts[2], user.id);
        await r.remove('cvVersions', parts[2]);
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
    const period = new Date().toISOString().slice(0, 10);
    return {
      data: {
        period,
        timezone: 'UTC',
        usage: await read((r) =>
          r.get('entitlementUsage', `${user.id}:${period}`),
        ),
        plan: (await configuredPlans()).find((plan) => plan.code === user.plan),
      },
    };
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
    const input = z
      .object({ message: z.string().trim().min(1).max(300) })
      .parse(await body());
    const question = input.message.toLowerCase();
    if (/password|oauth|mailbox|payment|billing|cv upload/.test(question))
      return {
        data: {
          mode: 'guided-help',
          answer:
            'Use your workspace for profile, mailbox and billing controls. Mail delivery, scanned file uploads and payments remain unavailable until their providers are configured. Never share passwords or tokens in chat.',
          jobs: [],
        },
      };
    const result = await searchJobs(
      new URLSearchParams({ q: input.message }),
      user,
    );
    return {
      data: {
        mode: 'keyword-search',
        answer: result.total
          ? `I found ${result.total} matching opportunities. This assistant currently uses keyword search; review each job and its eligibility before applying.`
          : 'No exact keyword matches. Try a role, skill or location such as React, design, remote or India.',
        jobs: result.jobs.slice(0, 5),
      },
    };
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
    if (method === 'GET')
      return { data: await read((r) => r.find('jobSources', {}, 100)) };
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
      const record = {
        id: id(),
        type: 'greenhouse',
        ...input,
        reviewedBy: user.id,
        reviewedAt: new Date().toISOString(),
      };
      await transaction(async (r) => {
        await r.put('jobSources', record);
        await audit(r, user.id, 'source.policy_created', record.id);
      });
      return { data: record, status: 201 };
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
