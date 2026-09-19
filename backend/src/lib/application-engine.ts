import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApplicationStatus, Job, Plan, User } from './domain.js';
import { isRecent, publicJob } from './domain.js';
import type { Repository } from './store.js';
import { configuredPlans, read, transaction } from './store.js';
import { ApiError, audit, rateLimit } from './security.js';
import { assessDestination, assessJob } from './fraud-detection.js';
import { sendMailboxMessage } from '../mailbox-auth.js';
import { getMatches } from './matching-engine.js';
import { configuredCvProviders } from './cv-providers.js';
import { downloadCv } from './cv-service.js';
import type { AutomationPreferences } from './student-preferences.js';
import { consumeEntitlement, entitlementUsage, resolveStudentEntitlements, type StudentEntitlements } from './student-entitlements.js';

export type ApplicationEvent = { status: ApplicationStatus; at: string; actorId: string; reasonCode?: string };
export type ApplicationRecord = {
  id: string; userId: string; jobId: string; employerId: string; method: Job['method']; status: ApplicationStatus;
  priority: number; createdAt: string; scheduledAt: string; jobVerifiedAt: string; attempts: number; maxAttempts: number;
  leaseOwner?: string; leaseUntil?: string; providerMessageId?: string; lastErrorCode?: string;
  job: { title: string; country: string; city: string }; events: ApplicationEvent[]; snapshot: unknown;
  automated?: boolean;
  delivery?: { destination: string };
};
type Template = { id: string; subject: string; body: string; signature: string; updatedAt?: string };
type CvVersion = { id: string; userId: string; confirmed: true; documentId?: string; name: string; createdAt: string; profile: unknown };
type Consent = { granted: boolean };
type Mailbox = { status: 'connected' | 'revoked'; email: string; scopes: string[] };

export const applicationRequestSchema = z.object({ jobId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/) }).strict();
export const applicationPolicySchema = z.object({
  version: z.string().regex(/^[a-zA-Z0-9._-]{1,60}$/).default('application-v1'),
  delaysMinutes: z.record(z.enum(['basic', 'pro', 'premium']), z.record(z.enum(['direct', 'external', 'email']), z.number().int().min(0).max(10080))).default({
    basic: { direct: 1440, external: 1440, email: 1440 }, pro: { direct: 60, external: 60, email: 60 }, premium: { direct: 0, external: 0, email: 0 },
  }),
  priorities: z.record(z.enum(['basic', 'pro', 'premium']), z.number().int().min(1).max(100)).default({ basic: 10, pro: 50, premium: 100 }),
  maxSendAttempts: z.number().int().min(1).max(10).default(3), retryMinutes: z.number().int().min(1).max(1440).default(15),
  providerPerMinute: z.number().int().min(1).max(1000).default(10),
}).strict();
export type ApplicationPolicy = z.infer<typeof applicationPolicySchema>;
export const defaultApplicationPolicy = () => applicationPolicySchema.parse({});

async function policy(r: Repository) {
  const row = await r.get<{ value: unknown; revision: number }>('systemConfig', 'application-policy');
  try { return { value: applicationPolicySchema.parse(row?.value ?? {}), revision: row?.revision ?? 0 }; }
  catch { throw new ApiError(503, 'APPLICATION_POLICY_INVALID', 'Application configuration requires administrator review.'); }
}
export async function configureApplicationPolicy(actor: User, input: unknown) {
  const data = z.object({ expectedRevision: z.number().int().min(0), policy: applicationPolicySchema }).strict().parse(input);
  return transaction(async r => {
    const current = await r.get<User>('users', actor.id), previous = await policy(r);
    if (!current || current.disabled || current.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
    if (previous.revision !== data.expectedRevision) throw new ApiError(409, 'APPLICATION_POLICY_CONFLICT', 'Reload application policy before saving.');
    await r.put('systemConfig', { id: 'application-policy', revision: previous.revision + 1, value: data.policy });
    await audit(r, actor.id, 'application.policy.updated', 'application-policy');
    return { policy: data.policy, revision: previous.revision + 1 };
  });
}
export async function getApplicationPolicy() { return read(async r => { const row = await policy(r); return { policy: row.value, revision: row.revision }; }); }

function render(template: Template, user: User, job: Job) {
  const values: Record<string, string> = { name: user.profile.name || user.name, job_title: job.title };
  const replace = (text: string) => text.replace(/\{\{(name|job_title)\}\}/g, (_, key) => values[key]);
  return { subject: replace(template.subject), text: [replace(template.body), replace(template.signature)].filter(Boolean).join('\n\n') };
}
async function prerequisites(r: Repository, user: User, job: Job, entitlements: StudentEntitlements, automation: boolean) {
  const reasons: string[] = [];
  if (!user.verified) reasons.push('EMAIL_UNVERIFIED');
  if (!user.profile.confirmed || !user.profile.skills.length) reasons.push('PROFILE_UNCONFIRMED');
  if (!isRecent(job) || job.trust !== 'verified') reasons.push('JOB_UNAVAILABLE');
  const fraud = await assessJob(r, job);
  if (fraud.riskLevel === 'high' || fraud.riskLevel === 'blocked' || (automation && !fraud.automationAllowed)) reasons.push('FRAUD_RISK');
  if (job.sample && process.env.DEMO_MODE !== 'true') reasons.push('SAMPLE_JOB');
  if (automation && !entitlements.features.autoApply) reasons.push('PLAN_AUTOMATION_DISABLED');
  const automationConsent = await r.get<Consent>('candidateConsents', user.id + ':automation');
  if (automation && automationConsent?.granted !== true) reasons.push('AUTOMATION_CONSENT_REQUIRED');
  if (automation && (!user.preferences.automation || user.preferences.automationConstraints?.enabled === false)) reasons.push('AUTOMATION_PAUSED');
  const cv = user.activeCvVersionId ? await r.get<CvVersion>('cvVersions', user.activeCvVersionId) : null;
  const productionAssetsRequired = automation || process.env.DEMO_MODE !== 'true';
  if (productionAssetsRequired && (!cv || cv.userId !== user.id || cv.confirmed !== true)) reasons.push('CONFIRMED_CV_REQUIRED');
  const template = await r.get<Template>('applicationTemplates', user.id);
  if (productionAssetsRequired && !template) reasons.push('APPROVED_TEMPLATE_REQUIRED');
  let mailboxConnected = false;
  if (job.method === 'email') {
    const mailbox = await r.get<Mailbox>('mailboxConnections', user.id);
    const mailConsent = await r.get<Consent>('candidateConsents', user.id + ':mailbox');
    mailboxConnected = !!mailbox && mailbox.status === 'connected' && mailbox.email === user.email.toLowerCase() && mailbox.scopes.length === 1 && mailbox.scopes[0] === 'https://www.googleapis.com/auth/gmail.send';
    if (!mailboxConnected) reasons.push('MAILBOX_REQUIRED');
    if (mailConsent?.granted !== true) reasons.push('MAILBOX_CONSENT_REQUIRED');
    const destinationRisk = await assessDestination(r, job);
    if (!job.email || destinationRisk.riskLevel !== 'low') reasons.push('DESTINATION_UNVERIFIED');
    if (!cv?.documentId || !configuredCvProviders()) reasons.push('CV_ATTACHMENT_UNAVAILABLE');
  }
  let canonicalExternal = false;
  try { canonicalExternal = !!job.url && new URL(job.url).protocol === 'https:'; } catch { /* invalid stored URL */ }
  if (job.method === 'external' && !canonicalExternal) reasons.push('CANONICAL_ATS_URL_REQUIRED');
  if (job.method === 'direct' && process.env.DEMO_MODE !== 'true') {
    const employer = job.employerId ? await r.get<{ status: string }>('employers', job.employerId) : null;
    if (!employer || employer.status !== 'verified') reasons.push('DIRECT_EMPLOYER_REQUIRED');
  }
  return { reasons, cv, template, mailboxConnected };
}
function withinSchedule(preferences: AutomationPreferences, now: Date) {
  if (!preferences.schedule) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: preferences.schedule.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const time = `${parts.hour}:${parts.minute}`;
  return preferences.schedule.days.includes(day) && time >= preferences.schedule.start && time < preferences.schedule.end;
}

function automationReasons(job: Job, preferences: AutomationPreferences, now: Date) {
  const reasons: string[] = [];
  const norm = (value: string) => value.trim().toLowerCase();
  if (preferences.paused || !preferences.enabled) reasons.push('AUTOMATION_PAUSED');
  if (!withinSchedule(preferences, now)) reasons.push('OUTSIDE_AUTOMATION_SCHEDULE');
  if (preferences.excludedRoles.some(role => norm(job.title).includes(norm(role)))) reasons.push('ROLE_EXCLUDED');
  if (preferences.allowedRoleFamilies.length && (!job.matching?.occupationId || !preferences.allowedRoleFamilies.includes(job.matching.occupationId))) reasons.push('ROLE_NOT_ALLOWED');
  if (preferences.allowedLocations.length && (!job.matching?.locationId || !preferences.allowedLocations.includes(job.matching.locationId))) reasons.push('LOCATION_NOT_ALLOWED');
  if (job.matching?.locationId && preferences.excludedLocations.includes(job.matching.locationId)) reasons.push('LOCATION_EXCLUDED');
  if (preferences.workModes.length && !preferences.workModes.includes(job.mode as typeof preferences.workModes[number])) reasons.push('WORK_MODE_NOT_ALLOWED');
  if (preferences.employmentTypes.length && !preferences.employmentTypes.some(type => norm(type) === norm(job.type))) reasons.push('EMPLOYMENT_TYPE_NOT_ALLOWED');
  if (preferences.minimumSalary && (job.currency !== preferences.minimumSalary.currency || job.salaryMax < preferences.minimumSalary.amount)) reasons.push('SALARY_NOT_ALLOWED');
  return reasons;
}

export async function applicationEligibility(userId: string, input: unknown, automation = false, now = new Date()) {
  const { jobId } = applicationRequestSchema.parse(input), plans = await configuredPlans();
  return read(async r => {
    const user = await r.get<User>('users', userId); if (!user || user.disabled || user.role !== 'student') throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    const job = await r.get<Job>('jobs', jobId); if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found.');
    const entitlements = await resolveStudentEntitlements(r, user, plans, now), plan = entitlements.plan;
    const result = await prerequisites(r, user, job, entitlements, automation), usage = await entitlementUsage(r, user, entitlements, automation ? 'auto_apply' : 'applications', now);
    if (usage.used >= usage.cap) result.reasons.push('DAILY_CAP_REACHED');
    if (automation) {
      const record = await r.get<{ preferences: AutomationPreferences }>('automationPreferences', user.id);
      if (!record) result.reasons.push('AUTOMATION_PREFERENCES_REQUIRED'); else result.reasons.push(...automationReasons(job, record.preferences, now));
      if (user.preferences.automationConstraints?.excludedMethods.includes(job.method)) result.reasons.push('METHOD_EXCLUDED');
    }
    const currentPolicy = (await policy(r)).value;
    return { eligible: result.reasons.length === 0, reasons: [...new Set(result.reasons)], quota: { used: usage.used, cap: usage.cap }, planCode: plan.code, subscriptionStatus: entitlements.subscriptionStatus, scheduledAt: new Date(now.getTime() + currentPolicy.delaysMinutes[plan.code][job.method] * 60000).toISOString(), priority: currentPolicy.priorities[plan.code] };
  });
}

export async function createApplication(userId: string, input: unknown, automation = false, now = new Date()) {
  const { jobId } = applicationRequestSchema.parse(input), plans = await configuredPlans();
  return transaction(async r => {
    const user = await r.get<User>('users', userId);
    if (!user || user.disabled || user.role !== 'student') throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    const existing = (await r.find<ApplicationRecord>('applications', { userId, jobId }, 1))[0];
    if (existing) return { application: existing, created: false };
    const job = await r.get<Job>('jobs', jobId); if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found.');
    const entitlements = await resolveStudentEntitlements(r, user, plans, now), plan = entitlements.plan;
    const required = await prerequisites(r, user, job, entitlements, automation), usage = await entitlementUsage(r, user, entitlements, automation ? 'auto_apply' : 'applications', now);
    if (usage.used >= usage.cap) required.reasons.push('DAILY_CAP_REACHED');
    if (automation) {
      const constraints = user.preferences.automationConstraints;
      if (constraints?.excludedMethods.includes(job.method)) required.reasons.push('METHOD_EXCLUDED');
      const automationRecord = await r.get<{ preferences: AutomationPreferences }>('automationPreferences', user.id);
      if (!automationRecord) required.reasons.push('AUTOMATION_PREFERENCES_REQUIRED');
      else required.reasons.push(...automationReasons(job, automationRecord.preferences, now));
    }
    if (required.reasons.length) throw new ApiError(409, 'NOT_ELIGIBLE', [...new Set(required.reasons)].join(' '));
    const currentPolicy = (await policy(r)).value, delay = currentPolicy.delaysMinutes[plan.code][job.method];
    const eligibleAt = new Date(Math.max(now.getTime(), Date.parse(job.discoveredAt))), scheduledAt = new Date(eligibleAt.getTime() + delay * 60000).toISOString();
    const production = process.env.DEMO_MODE !== 'true';
    const status: ApplicationStatus = job.method === 'external' ? (automation ? 'NEEDS_REVIEW' : 'EXTERNAL_STARTED') : production ? 'QUEUED' : 'DIRECT_SUBMITTED';
    const message = required.template ? render(required.template, user, job) : { subject: '', text: '' }, application: ApplicationRecord = {
      id: randomUUID(), userId, jobId, employerId: job.employerId, method: job.method, status,
      priority: currentPolicy.priorities[plan.code], createdAt: now.toISOString(), scheduledAt, jobVerifiedAt: eligibleAt.toISOString(), attempts: 0, maxAttempts: currentPolicy.maxSendAttempts, automated: automation,
      job: { title: job.title, country: job.country, city: job.city }, events: [{ status, at: now.toISOString(), actorId: userId }],
      ...(job.method === 'email' ? { delivery: { destination: job.email! } } : {}),
      snapshot: { version: 'application-v3', profileRevision: user.profileRevision ?? 0, profile: user.profile, cvVersion: required.cv, template: required.template, rendered: message, job: publicJob(job, user, [plan]), policyVersion: currentPolicy.version, entitlement: { planCode: plan.code, subscriptionId: entitlements.subscription?.id, subscriptionRevision: entitlements.subscription?.revision ?? 0 } },
    };
    await r.put('applications', application);
    await consumeEntitlement(r, user, entitlements, 'applications', now);
    if (automation) await consumeEntitlement(r, user, entitlements, 'auto_apply', now);
    await audit(r, userId, 'application.' + status.toLowerCase(), application.id);
    return { application, created: true, externalUrl: job.method === 'external' ? job.url : undefined };
  });
}

/** Removes immutable application inputs and delivery coordinates from API output. */
export function publicApplication(application: ApplicationRecord) {
  const { snapshot: _snapshot, delivery: _delivery, leaseOwner: _leaseOwner, leaseUntil: _leaseUntil, providerMessageId: _providerMessageId, ...safe } = application;
  return safe;
}

/** Candidate-approved fields visible only to the owning employer for direct applications. */
export function employerApplication(application: ApplicationRecord) {
  const safe = publicApplication(application);
  const snapshot = application.snapshot as { profile?: User['profile']; cvVersion?: { id?: string; name?: string } };
  return { ...safe, candidate: snapshot.profile ? { name: snapshot.profile.name, headline: snapshot.profile.headline, skills: snapshot.profile.skills, experience: snapshot.profile.experience, education: snapshot.profile.education, country: snapshot.profile.country, city: snapshot.profile.city } : null, cv: snapshot.cvVersion ? { versionId: snapshot.cvVersion.id, name: snapshot.cvVersion.name } : null };
}

export async function previewApplication(userId: string, input: unknown) {
  const { jobId } = applicationRequestSchema.parse(input);
  return read(async r => {
    const user = await r.get<User>('users', userId), job = await r.get<Job>('jobs', jobId), template = await r.get<Template>('applicationTemplates', userId);
    if (!user || user.disabled || user.role !== 'student') throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found.'); if (!template) throw new ApiError(409, 'APPROVED_TEMPLATE_REQUIRED', 'Save an application template first.');
    return { jobId, cvVersionId: user.activeCvVersionId ?? null, ...render(template, user, job) };
  });
}

export async function scheduleAutomaticApplications(userId: string) {
  const automation = await read(r => r.get<{ preferences: AutomationPreferences }>('automationPreferences', userId));
  if (!automation?.preferences.enabled || automation.preferences.paused) return { scheduled: 0, skipped: 'PAUSED' };
  const minimumMatch = (await read(r => r.get<User>('users', userId)))?.preferences.automationConstraints?.minimumMatch ?? 0;
  const matches = await getMatches(userId, { limit: Math.min(30, automation.preferences.dailyCap) }); let scheduled = 0;
  for (const row of matches.items) {
    if (row.match.score < minimumMatch) continue;
    try { const result = await createApplication(userId, { jobId: row.job.id }, true); if (result.created) scheduled++; }
  catch (error) { if (!(error instanceof ApiError) || ![409, 503].includes(error.status)) throw error; }
  }
  return { scheduled };
}

export async function scheduleAutomaticApplicationBatch(after = '', limit = 100) {
  const users = await read(r => r.scan<User>('users', { role: 'student', disabled: { $ne: true } }, after, Math.min(250, limit)));
  let scheduled = 0;
  for (const user of users) scheduled += (await scheduleAutomaticApplications(user.id)).scheduled;
  return { users: users.length, scheduled, next: users.at(-1)?.id ?? null };
}

export async function processDueEmailApplications(owner: string = randomUUID(), batch = 10, now = new Date()) {
  const claimed: ApplicationRecord[] = [];
  await transaction(async r => {
    const candidates = await r.find<ApplicationRecord>('applications', { status: 'QUEUED' }, Math.min(100, batch * 5));
    for (const item of candidates.filter(a => ['email', 'direct'].includes(a.method) && a.scheduledAt <= now.toISOString() && (!a.leaseUntil || a.leaseUntil < now.toISOString())).sort((a,b) => b.priority-a.priority || a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id)).slice(0,batch)) {
      const next = { ...item, status: 'SENDING' as const, leaseOwner: owner, leaseUntil: new Date(now.getTime()+120000).toISOString(), attempts: item.attempts + 1, events: [...item.events, { status: 'SENDING' as const, at: now.toISOString(), actorId: 'application-sender' }] };
      await r.put('applications', next); claimed.push(next);
    }
  });
  for (const item of claimed) {
    try {
      if (item.automated) {
        const allowed = await read(async r => {
          const user = await r.get<User>('users', item.userId);
          return !!user && (await resolveStudentEntitlements(r, user, await configuredPlans(), now)).features.autoApply;
        });
        if (!allowed) throw new ApiError(409, 'ENTITLEMENT_EXPIRED', 'Auto-apply entitlement is no longer active.');
      }
      if (item.method === 'direct') {
        await transaction(async r => {
          const current = await r.get<ApplicationRecord>('applications', item.id); if (current?.leaseOwner !== owner) return;
          const employer = await r.get<{ status: string }>('employers', item.employerId);
          if (employer?.status !== 'verified') throw new ApiError(409, 'DIRECT_EMPLOYER_REQUIRED', 'Employer verification is required.');
          const job = await r.get<Job>('jobs', item.jobId); if (!job) throw new ApiError(409, 'JOB_UNAVAILABLE', 'Job is unavailable.');
          const fraud = await assessJob(r, job); if (fraud.riskLevel === 'high' || fraud.riskLevel === 'blocked') throw new ApiError(409, 'FRAUD_RISK', 'Job requires fraud review.');
          const at = new Date().toISOString();
          await r.put('applications', { ...current, status: 'DIRECT_SUBMITTED', leaseOwner: undefined, leaseUntil: undefined, events: [...current.events, { status: 'DIRECT_SUBMITTED', at, actorId: 'application-scheduler' }] });
          await audit(r, item.userId, 'application.direct_submitted', item.id);
        });
        continue;
      }
      const user = await read(r => r.get<User>('users', item.userId)); if (!user) throw new Error();
      const snapshot = item.snapshot as { rendered: { subject: string; text: string }; cvVersion: CvVersion };
      const destination = item.delivery?.destination; if (!destination) throw new Error();
      const job = await read(r => r.get<Job>('jobs', item.jobId)); if (!job) throw new Error();
      const destinationRisk = await read(r => assessDestination(r, job)); if (destinationRisk.riskLevel !== 'low') throw new ApiError(409, 'FRAUD_RISK', 'Application destination requires review.');
      const providers = configuredCvProviders(); if (!providers || !snapshot.cvVersion.documentId) throw new Error();
      const attachment = await downloadCv(user.id, snapshot.cvVersion.documentId, providers);
      if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(attachment.contentType)) throw new Error();
      const currentPolicy = await read(async r => (await policy(r)).value);
      await rateLimit('application-provider:gmail', currentPolicy.providerPerMinute);
      const result = await sendMailboxMessage(user, { to: destination, subject: snapshot.rendered.subject, text: snapshot.rendered.text, attachment: { ...attachment, contentType: attachment.contentType as 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } });
      await transaction(async r => { const current = await r.get<ApplicationRecord>('applications', item.id); if (current?.leaseOwner !== owner) return; const at = new Date().toISOString(); await r.put('applications', { ...current, status: 'SENT', providerMessageId: result.providerMessageId, leaseOwner: undefined, leaseUntil: undefined, events: [...current.events, { status: 'SENT', at, actorId: 'application-sender' }] }); await audit(r, item.userId, 'application.sent', item.id); });
    } catch (error) {
      await transaction(async r => { const current = await r.get<ApplicationRecord>('applications', item.id); if (current?.leaseOwner !== owner) return; const currentPolicy = (await policy(r)).value, review = error instanceof ApiError && ['FRAUD_RISK', 'ENTITLEMENT_EXPIRED'].includes(error.code), terminal = current.attempts >= current.maxAttempts, at = new Date().toISOString(); const status: ApplicationStatus = review ? 'NEEDS_REVIEW' : terminal ? 'FAILED' : 'QUEUED', reasonCode = error instanceof ApiError && error.code === 'ENTITLEMENT_EXPIRED' ? 'ENTITLEMENT_EXPIRED' : review ? 'FRAUD_RISK' : 'MAIL_SEND_FAILED'; await r.put('applications', { ...current, status, scheduledAt: new Date(Date.now()+currentPolicy.retryMinutes*60000).toISOString(), lastErrorCode: reasonCode, leaseOwner: undefined, leaseUntil: undefined, events: [...current.events, { status, at, actorId: 'application-sender', reasonCode }] }); await audit(r, item.userId, review ? 'application.needs_review' : terminal ? 'application.failed' : 'application.retry_scheduled', item.id); });
    }
  }
  return { processed: claimed.length };
}
