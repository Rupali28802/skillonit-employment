import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { ApplicationStatus, Job, Plan, User } from './domain.js';
import { isRecent, publicJob, transitions } from './domain.js';
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
import { createNotificationRecord } from './notification-platform.js';
import { renderAts } from './ats-cv.js';
import { applicationMethod, safeApplicationReason, submissionState } from './application-routing.js';
import { listApplicationTemplates, renderApplicationTemplate, resolveApplicationTemplate, type ApplicationTemplate } from './application-templates.js';
import { roleSuggestionEvidence } from './role-suggestions.js';

export type ApplicationEvent = { status: ApplicationStatus; at: string; actorId: string; reasonCode?: string };
export type ApplicationRecord = {
  id: string; userId: string; jobId: string; employerId: string; method: Job['method']; status: ApplicationStatus;
  priority: number; createdAt: string; scheduledAt: string; jobVerifiedAt: string; attempts: number; maxAttempts: number;
  leaseOwner?: string; leaseUntil?: string; providerMessageId?: string; lastErrorCode?: string;
  job: { title: string; country: string; city: string }; events: ApplicationEvent[]; snapshot: unknown;
  automated?: boolean;
  updatedAt?: string; submittedAt?: string; sentAt?: string; confirmedAt?: string;
  reviewReasons?: string[]; submissionEvidence?: 'provider' | 'platform' | 'candidate_reported';
  creditUsageIds?: string[]; creditsReleasedAt?: string;
  delivery?: { destination: string };
};
type CvVersion = { id: string; userId: string; confirmed: true; documentId?: string; name: string; createdAt: string; profile: User['profile']; content?: string };
type Consent = { granted: boolean };
type Mailbox = { status: 'connected' | 'revoked'; email: string; scopes: string[] };

export const applicationRequestSchema = z.object({
  jobId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/),
  templateId: z.string().uuid().optional(),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().trim().min(10).max(6000).optional(),
  /** Required on the state-changing manual endpoint; omitted by read-only previews. */
  confirmed: z.literal(true).optional(),
}).strict();

/** Returns only a browser-safe, source-owned HTTPS application destination. */
export function externalApplicationUrl(job: Pick<Job, 'method' | 'url'>) {
  if (job.method !== 'external' || !job.url) return undefined;
  try {
    const url = new URL(job.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(url.hostname) || !url.hostname.includes('.') || /(^|\.)(localhost|local|internal|invalid|test)$/.test(url.hostname)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
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

async function prerequisites(r: Repository, user: User, job: Job, entitlements: StudentEntitlements, automation: boolean, templateId?:string) {
  const reasons: string[] = [];
  const method = applicationMethod(job.method);
  if (method === 'UNSUPPORTED') reasons.push('METHOD_UNSUPPORTED');
  if (method === 'ATS') reasons.push('ATS_UNSUPPORTED');
  if (process.env.DEMO_MODE !== 'true' && process.env.ENABLE_APPLICATION_ENGINE !== 'true' && ['EMAIL','SKILLONIT'].includes(method)) reasons.push('APPLICATION_ENGINE_DISABLED');
  if (!user.verified) reasons.push('EMAIL_UNVERIFIED');
  // A source-owned external form receives no candidate data from SkillOnIT, so
  // opening it must not depend on profile completion. Native/email delivery still
  // requires reviewed candidate facts.
  if (job.method !== 'external' && (!user.profile.confirmed || !user.profile.skills.length)) reasons.push('PROFILE_UNCONFIRMED');
  const approvedPublicExternal = job.method === 'external' && job.feed?.publicListing === true;
  if (!isRecent(job) || (job.trust !== 'verified' && !approvedPublicExternal)) reasons.push('JOB_UNAVAILABLE');
  const fraud = await assessJob(r, job);
  if (fraud.riskLevel === 'high' || fraud.riskLevel === 'blocked' || (automation && !fraud.automationAllowed)) reasons.push('FRAUD_RISK');
  if (job.sample && process.env.DEMO_MODE !== 'true') reasons.push('SAMPLE_JOB');
  if (automation && !entitlements.features.autoApply) reasons.push('PLAN_AUTOMATION_DISABLED');
  const automationConsent = await r.get<Consent>('candidateConsents', user.id + ':automation');
  if (automation && automationConsent?.granted !== true) reasons.push('AUTOMATION_CONSENT_REQUIRED');
  if (automation && user.preferences.automationConstraints?.enabled === false) reasons.push('AUTOMATION_PAUSED');
  const cv = user.activeCvVersionId ? await r.get<CvVersion>('cvVersions', user.activeCvVersionId) : null;
  // Opening a source-owned external form shares no profile, CV or template with that
  // source. Those assets are required only when SkillonIT will deliver an application.
  const productionAssetsRequired = automation || (process.env.DEMO_MODE !== 'true' && job.method !== 'external');
  if (productionAssetsRequired && (!cv || cv.userId !== user.id || cv.confirmed !== true)) reasons.push('CONFIRMED_CV_REQUIRED');
  const template = await resolveApplicationTemplate(r,user.id,templateId);
  if (productionAssetsRequired && !template) reasons.push('APPROVED_TEMPLATE_REQUIRED');
  if(template&&renderApplicationTemplate(template,user,job).personalizationStatus==='NEEDS_REVIEW')reasons.push('AI_PERSONALIZATION_NEEDS_REVIEW');
  if(template?.attachCoverLetter)reasons.push('COVER_LETTER_REQUIRED');
  let mailboxConnected = false;
  if (job.method === 'email') {
    const mailbox = await r.get<Mailbox>('mailboxConnections', user.id);
    const mailConsent = await r.get<Consent>('candidateConsents', user.id + ':mailbox');
    mailboxConnected = !!mailbox && mailbox.status === 'connected' && mailbox.email === user.email.toLowerCase() && mailbox.scopes.length === 1 && mailbox.scopes[0] === 'https://www.googleapis.com/auth/gmail.send';
    if (!mailboxConnected) reasons.push('MAILBOX_REQUIRED');
    // A connected send-only mailbox is itself an explicit Google authorization.
    // A later explicit platform-level revocation still blocks delivery.
    if (mailConsent?.granted === false) reasons.push('MAILBOX_CONSENT_REQUIRED');
    const destinationRisk = await assessDestination(r, job);
    if (!z.email().safeParse(job.email).success || destinationRisk.riskLevel !== 'low') reasons.push('DESTINATION_UNVERIFIED');
    if (!cv?.documentId && !cv?.content && !cv?.profile) reasons.push('CV_ATTACHMENT_UNAVAILABLE');
  }
  if (job.method === 'external' && !externalApplicationUrl(job)) reasons.push('CANONICAL_ATS_URL_REQUIRED');
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
    const planDelays=currentPolicy.delaysMinutes[plan.code as keyof typeof currentPolicy.delaysMinutes]??currentPolicy.delaysMinutes.basic;
    const planPriority=currentPolicy.priorities[plan.code as keyof typeof currentPolicy.priorities]??currentPolicy.priorities.basic;
    return { eligible: result.reasons.length === 0, applicationMethod: applicationMethod(job.method), automaticSubmissionSupported: job.method === 'direct' || job.method === 'email', reasons: [...new Set(result.reasons)], quota: { used: usage.used, cap: usage.cap }, planCode: plan.code, subscriptionStatus: entitlements.subscriptionStatus, scheduledAt: new Date(now.getTime() + (planDelays[job.method] ?? 0) * 60000).toISOString(), priority: planPriority };
  });
}

export async function createApplication(userId: string, input: unknown, automation = false, now = new Date()) {
  const { jobId, confirmed, templateId, subject, body } = applicationRequestSchema.parse(input), plans = await configuredPlans();
  if (!automation && confirmed !== true)
    throw new ApiError(400, 'APPLICATION_CONFIRMATION_REQUIRED', 'Review and confirm this application before continuing.');
  return transaction(async r => {
    const user = await r.get<User>('users', userId);
    if (!user || user.disabled || user.role !== 'student') throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    const job = await r.get<Job>('jobs', jobId); if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found.');
    const externalUrl = externalApplicationUrl(job);
    const existing = (await r.find<ApplicationRecord>('applications', { userId, jobId }, 1))[0];
    if (existing && (automation || !['NEEDS_REVIEW', 'FAILED'].includes(existing.status) || existing.lastErrorCode === 'MAIL_SEND_UNCERTAIN')) return { application: existing, created: false, externalUrl };
    const entitlements = await resolveStudentEntitlements(r, user, plans, now), plan = entitlements.plan;
    const required = await prerequisites(r, user, job, entitlements, automation, templateId), usage = await entitlementUsage(r, user, entitlements, automation ? 'auto_apply' : 'applications', now);
    if (usage.used >= usage.cap) {
      if (automation && entitlements.plan.code === 'basic' && usage.cap === 5) {
        const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
        throw new ApiError(409, 'FREE_AUTO_APPLY_DAILY_LIMIT_REACHED', 'You have used all 5 Free Auto Apply applications for today. Auto Apply resets tomorrow.', { currentPlan: entitlements.plan.name, dailyLimit: 5, usedToday: usage.used, remainingToday: 0, resetAt });
      } else if (entitlements.plan.code === 'basic' && usage.cap === 5) {
        const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
        throw new ApiError(409, 'FREE_DAILY_APPLICATION_LIMIT_REACHED', 'You have used all 5 Free applications for today. Your daily application limit will reset tomorrow.', { limit: 5, used: usage.used, remaining: 0, resetAt, currentPlan: entitlements.plan.name });
      }
      required.reasons.push('DAILY_CAP_REACHED');
    }
    if (automation) {
      const constraints = user.preferences.automationConstraints;
      if (constraints?.excludedMethods.includes(job.method)) required.reasons.push('METHOD_EXCLUDED');
      const automationRecord = await r.get<{ preferences: AutomationPreferences }>('automationPreferences', user.id);
      if (!automationRecord) required.reasons.push('AUTOMATION_PREFERENCES_REQUIRED');
      else required.reasons.push(...automationReasons(job, automationRecord.preferences, now));
    }
    if (job.method === 'external') required.reasons.push('EXTERNAL_FORM_UNSUPPORTED');
    const currentPolicy = (await policy(r)).value, planDelays=currentPolicy.delaysMinutes[plan.code as keyof typeof currentPolicy.delaysMinutes]??currentPolicy.delaysMinutes.basic, delay = planDelays[job.method], planPriority=currentPolicy.priorities[plan.code as keyof typeof currentPolicy.priorities]??currentPolicy.priorities.basic;
    const eligibleAt = new Date(Math.max(now.getTime(), Date.parse(job.discoveredAt))), scheduledAt = new Date(eligibleAt.getTime() + (delay ?? 0) * 60000).toISOString();
    const production = process.env.DEMO_MODE !== 'true';
    if (existing && existing.attempts >= currentPolicy.maxSendAttempts) required.reasons.push('MAX_SEND_ATTEMPTS_REACHED');
    // Eligible automated email/direct applications enter the same isolated,
    // leased delivery queue as confirmed manual applications. External forms
    // remain review-only because no supported submission adapter exists.
    const status: ApplicationStatus = required.reasons.length ? 'NEEDS_REVIEW' : production || automation || job.method === 'email' ? 'QUEUED' : 'DIRECT_SUBMITTED';
    const generated = required.template ? renderApplicationTemplate(required.template, user, job) : { subject: '', text: '', personalizationStatus:'NEEDS_REVIEW',missingFacts:[] as string[] };
    const message = !automation&&subject&&body?{subject,text:body,personalizationStatus:'USER_EDITED',missingFacts:[]}:generated, application: ApplicationRecord = {
      id: existing?.id ?? createHash('sha256').update(JSON.stringify([userId, jobId])).digest('hex'), userId, jobId, employerId: job.employerId, method: job.method, status,
      priority: planPriority, createdAt: existing?.createdAt ?? now.toISOString(), scheduledAt, jobVerifiedAt: eligibleAt.toISOString(), attempts: existing?.attempts ?? 0, maxAttempts: currentPolicy.maxSendAttempts, automated: automation,
      updatedAt: now.toISOString(), reviewReasons: [...new Set(required.reasons)],
      ...(status === 'DIRECT_SUBMITTED' ? { submittedAt: now.toISOString(), submissionEvidence: 'platform' as const } : {}),
      job: { title: job.title, country: job.country, city: job.city }, events: [...(existing?.events ?? []), { status, at: now.toISOString(), actorId: userId }],
      ...(job.method === 'email' ? { delivery: { destination: job.email! } } : {}),
      snapshot: { version: 'application-v6', applicationUrl: externalUrl, profileRevision: user.profileRevision ?? 0, profile: user.profile, cvVersion: required.cv, template: required.template, rendered: message, aiPersonalizationStatus:message.personalizationStatus, roleEvidence: roleSuggestionEvidence(user.profile.skills, job.title), job: publicJob(job, user, [plan]), policyVersion: currentPolicy.version, entitlement: { planCode: plan.code, subscriptionId: entitlements.subscription?.id, subscriptionRevision: entitlements.subscription?.revision ?? 0 } },
    };
    if (existing?.creditUsageIds?.length && !existing.creditsReleasedAt) application.creditUsageIds = existing.creditUsageIds;
    if (status !== 'NEEDS_REVIEW' && !application.creditUsageIds?.length) {
      // Manual and Auto Apply allowances are intentionally independent.
      application.creditUsageIds = [(await consumeEntitlement(r, user, entitlements, automation ? 'auto_apply' : 'applications', now)).id];
    }
    await r.put('applications', application);
    await audit(r, userId, existing ? 'APPLICATION_RETRY' : 'APPLICATION_CREATED', application.id);
    await audit(r, userId, status === 'NEEDS_REVIEW' ? 'APPLICATION_NEEDS_REVIEW' : 'APPLICATION_READY', application.id);
    await audit(r, userId, 'application.' + status.toLowerCase(), application.id);
    if (status === 'DIRECT_SUBMITTED') await createNotificationRecord(r, { userId: application.employerId, type: 'application_status', title: 'New application', message: `A candidate applied to ${application.job.title}.`, href: '/employer/applicants', dedupeKey: `employer-application:${application.id}` });
    return { application, created: !existing, externalUrl: required.reasons.every(code => code === 'EXTERNAL_FORM_UNSUPPORTED') ? externalUrl : undefined };
  });
}

/** Removes immutable application inputs and delivery coordinates from API output. */
export function publicApplication(application: ApplicationRecord) {
  const { id, userId, jobId, employerId, method, status, createdAt, scheduledAt, job, attempts, maxAttempts } = application;
  const company = (application.snapshot as {job?: {company?: string}})?.job?.company ?? null;
  const updatedAt = [application.updatedAt, application.events.at(-1)?.at, createdAt].filter((value): value is string => !!value).sort().at(-1)!;
  return { id, userId, jobId, employerId, method, applicationMethod: applicationMethod(method), status, submissionState: submissionState(status), createdAt, updatedAt, scheduledAt, job, company, attempts, maxAttempts,
    submittedAt: application.submittedAt ?? application.events.find(e => ['SENT','DIRECT_SUBMITTED','EXTERNAL_SUBMITTED'].includes(e.status))?.at ?? null,
    submissionEvidence: application.submissionEvidence ?? (status === 'EXTERNAL_SUBMITTED' ? 'candidate_reported' : null),
    reasons: [...new Set([...(application.reviewReasons ?? []), ...(application.lastErrorCode ? [application.lastErrorCode] : [])])].map(code => ({ code, message: safeApplicationReason(code) })),
    events: application.events.map(({ status, at, reasonCode }) => ({ status, at, ...(reasonCode ? { reason: safeApplicationReason(reasonCode) } : {}) })),
  };
}

/** Owner/admin-only details: explicit metadata allowlist, never raw snapshots or CV URLs. */
export function applicationDetails(application: ApplicationRecord) {
  const snapshot = application.snapshot as { applicationUrl?: string; profileRevision?: number; cvVersion?: { id?: string; name?: string }; template?: { id?: string; templateName?:string; updatedAt?: string; attachCv?:boolean; attachCoverLetter?:boolean }; rendered?: { subject?: string; text?:string }; aiPersonalizationStatus?:string; roleEvidence?:unknown; job?: { company?: string; url?: string } };
  return { ...publicApplication(application), company: snapshot?.job?.company ?? null,
    profileRevision: snapshot?.profileRevision ?? null, cv: snapshot?.cvVersion ? { id: snapshot.cvVersion.id, name: snapshot.cvVersion.name } : null,
    template: snapshot?.template ? { id: snapshot.template.id, name:snapshot.template.templateName??null, version: snapshot.template.updatedAt } : null,
    attachments:snapshot?.template?{cv:Boolean(snapshot.template.attachCv&&snapshot.cvVersion),coverLetter:Boolean(snapshot.template.attachCoverLetter)}:null,
    aiPersonalizationStatus:snapshot?.aiPersonalizationStatus??null, roleEvidence:snapshot?.roleEvidence??null,
    email: application.method === 'email' ? { recipient: application.delivery?.destination ?? null, subject: snapshot?.rendered?.subject ?? null, body:snapshot?.rendered?.text??null, provider: 'gmail', sentAt: application.sentAt ?? null, providerMessageId: application.providerMessageId ? `…${application.providerMessageId.slice(-6)}` : null } : null,
    external: application.method === 'external' ? { url: externalApplicationUrl({ method: 'external', url: snapshot?.applicationUrl ?? snapshot?.job?.url }), fieldsSubmitted: [], automatedSubmissionSupported: false } : null,
    retryEligible: application.status === 'FAILED' && application.attempts < application.maxAttempts && application.lastErrorCode !== 'MAIL_SEND_UNCERTAIN',
  };
}

export async function releaseApplicationCredits(r: Repository, application: ApplicationRecord, at: string) {
  if (application.creditsReleasedAt || !application.creditUsageIds?.length) return application;
  for (const id of application.creditUsageIds) {
    const usage = await r.get<{ id: string; count: number }>('entitlementUsage', id);
    if (usage) await r.put('entitlementUsage', { ...usage, count: Math.max(0, usage.count - 1), updatedAt: at });
  }
  return { ...application, creditsReleasedAt: at };
}

/** Candidate-approved fields visible only to the owning employer for direct applications. */
export function employerApplication(application: ApplicationRecord) {
  const { id, jobId, status, createdAt, job, events } = application;
  const safe = { id, jobId, status, createdAt, job, allowedTransitions: (transitions[status] || []).filter(next => ['VIEWED','SHORTLISTED','INTERVIEW','OFFER','REJECTED'].includes(next)), events: events.map(({ status, at }) => ({ status, at })) };
  const snapshot = application.snapshot as { profile?: User['profile']; cvVersion?: { id?: string; name?: string } };
  return { ...safe, candidate: snapshot.profile ? { name: snapshot.profile.name, headline: snapshot.profile.headline, skills: snapshot.profile.skills, experience: snapshot.profile.experience, education: snapshot.profile.education, country: snapshot.profile.country, city: snapshot.profile.city } : null, cv: snapshot.cvVersion ? { versionId: snapshot.cvVersion.id, name: snapshot.cvVersion.name } : null };
}

export async function previewApplication(userId: string, input: unknown) {
  const { jobId,templateId } = applicationRequestSchema.parse(input);
  return read(async r => {
    const user = await r.get<User>('users', userId), job = await r.get<Job>('jobs', jobId);
    if (!user || user.disabled || user.role !== 'student') throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    if (!job) throw new ApiError(404, 'NOT_FOUND', 'Job not found.');
    const template=await resolveApplicationTemplate(r,user.id,templateId);
    const mailbox = await r.get<Mailbox>('mailboxConnections', user.id);
    const mailboxConsent = await r.get<Consent>('candidateConsents', user.id + ':mailbox');
    const cv = user.activeCvVersionId ? await r.get<CvVersion>('cvVersions', user.activeCvVersionId) : null;
    const externalUrl = externalApplicationUrl(job);
    const destinationHost = externalUrl ? new URL(externalUrl).hostname : null;
    const mailboxConnected = !!mailbox && mailbox.status === 'connected' && mailbox.email === user.email.toLowerCase() && mailbox.scopes.length === 1 && mailbox.scopes[0] === 'https://www.googleapis.com/auth/gmail.send';
    const missingRequirements: { code: string; label: string; href: string }[] = [];
    if (job.method !== 'external') {
      if (!user.profile.confirmed || !user.profile.skills.length) missingRequirements.push({ code: 'PROFILE_UNCONFIRMED', label: 'Complete and confirm your profile', href: '/profile' });
      if (!cv || cv.userId !== user.id || cv.confirmed !== true) missingRequirements.push({ code: 'CONFIRMED_CV_REQUIRED', label: 'Select a confirmed CV', href: '/cvs' });
      if (!template) missingRequirements.push({ code: 'APPROVED_TEMPLATE_REQUIRED', label: 'Save your application message', href: '/templates' });
    }
    if (job.method === 'email') {
      if (!mailboxConnected) missingRequirements.push({ code: 'MAILBOX_REQUIRED', label: 'Connect your Gmail account', href: '/mail' });
      if (mailboxConsent?.granted === false) missingRequirements.push({ code: 'MAILBOX_CONSENT_REQUIRED', label: 'Allow Gmail applications', href: '/settings' });
      if (!job.email) missingRequirements.push({ code: 'DESTINATION_UNVERIFIED', label: 'A verified application email is required', href: `/jobs/${job.id}` });
    }
    const entitlements = await resolveStudentEntitlements(r, user, await configuredPlans());
    const required = await prerequisites(r, user, job, entitlements, false,templateId);
    const usage = await entitlementUsage(r, user, entitlements, 'applications');
    if (usage.used >= usage.cap) required.reasons.push('DAILY_CAP_REACHED');
    for (const code of required.reasons) if (!missingRequirements.some(item => item.code === code)) missingRequirements.push({ code, label: safeApplicationReason(code), href: '/applications' });
    const rendered = template ? renderApplicationTemplate(template, user, job) : null;
    return {
      jobId,
      applicationMethod: applicationMethod(job.method),
      job: { title: job.title, company: job.company, source: job.source, method: job.method },
      action: job.method === 'external' ? 'open_source_form' : job.method === 'email' ? 'send_authorized_email' : 'submit_to_employer',
      destinationHost,
      destinationKind: job.method === 'external' ? job.feed?.applicationTarget || 'source-job-page' : null,
      requiresConfirmation: true,
      readyToConfirm: missingRequirements.length === 0,
      missingRequirements,
      dataShared: job.method === 'external' ? [] : ['confirmed candidate profile', ...(user.activeCvVersionId ? ['confirmed CV'] : []), ...(template ? ['approved application message'] : [])],
      email: {
        address: user.email,
        used: job.method === 'email',
        connected: mailboxConnected,
        destination: job.method === 'email' ? job.email ?? null : null,
      },
      cvVersionId: user.activeCvVersionId ?? null,
      templates: (await listApplicationTemplates(user.id,r)).map(row=>({id:row.id,name:row.templateName,isDefault:row.isDefault})),
      selectedTemplateId:template?.id??null,
      review: job.method === 'external' ? null : {
        profile: {
          name: user.profile.name || user.name,
          email: user.email,
          headline: user.profile.headline,
          location: [user.profile.city, user.profile.country].filter(Boolean).join(', '),
          skills: user.profile.skills,
          experience: user.profile.experience,
          education: user.profile.education,
          contactInfo: user.profile.contactInfo || '',
        },
        cv: cv ? { id: cv.id, name: cv.documentId && configuredCvProviders() ? cv.name : `${cv.name}.txt`, attached: true } : null,
        message: rendered,
      },
      ...(rendered || {}),
    };
  });
}

export function profileResumeAttachment(cv: Pick<CvVersion, 'name' | 'content' | 'profile'>) {
  const filename = `${cv.name.replace(/[^\p{L}\p{N}._ -]/gu, '').trim() || 'resume'}.txt`;
  const text = cv.content?.trim() || renderAts(cv.profile);
  if (!text.trim()) throw new ApiError(409, 'CV_ATTACHMENT_UNAVAILABLE', 'The confirmed CV has no reusable content.');
  return { filename, contentType: 'text/plain' as const, base64: Buffer.from(text, 'utf8').toString('base64') };
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

export type ApplicationDeliveryMethod = 'email' | 'direct';

export async function processDueEmailApplications(
  owner: string = randomUUID(),
  batch = 10,
  now = new Date(),
  send = sendMailboxMessage,
  methods: readonly ApplicationDeliveryMethod[] = ['email', 'direct'],
) {
  const allowedMethods = [...new Set(methods)].filter((method): method is ApplicationDeliveryMethod => method === 'email' || method === 'direct');
  if (!allowedMethods.length) return { processed: 0 };
  const claimed = await transaction(async r => {
    const claimed: ApplicationRecord[] = [];
    // A crashed sender may have reached Gmail. Never reclaim and resend blindly.
    const abandoned = await r.find<ApplicationRecord>('applications', { status: 'SENDING', leaseUntil: { $lt: now.toISOString() } }, 100);
    for (const item of abandoned) {
      const status: ApplicationStatus = item.method === 'direct' ? 'QUEUED' : 'NEEDS_REVIEW';
      const reasonCode = item.method === 'direct' ? undefined : 'MAIL_SEND_UNCERTAIN';
      await r.put('applications', { ...item, status, lastErrorCode: reasonCode, updatedAt: now.toISOString(), leaseOwner: undefined, leaseUntil: undefined, events: [...item.events, { status, at: now.toISOString(), actorId: 'application-sender', reasonCode }] });
      await audit(r, item.userId, status === 'QUEUED' ? 'APPLICATION_RETRY' : 'APPLICATION_NEEDS_REVIEW', item.id);
    }
    const candidates = await r.page<ApplicationRecord>('applications', { status: 'QUEUED', method: { $in: allowedMethods }, scheduledAt: { $lte: now.toISOString() } }, { priority: -1, scheduledAt: 1, id: 1 }, 0, Math.min(100, batch * 5));
    for (const item of candidates.filter(a => allowedMethods.includes(a.method as ApplicationDeliveryMethod) && a.scheduledAt <= now.toISOString() && (!a.leaseUntil || a.leaseUntil < now.toISOString())).sort((a,b) => b.priority-a.priority || a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id)).slice(0,batch)) {
      const next = { ...item, status: 'SENDING' as const, leaseOwner: owner, leaseUntil: new Date(now.getTime()+120000).toISOString(), attempts: item.attempts + 1, events: [...item.events, { status: 'SENDING' as const, at: now.toISOString(), actorId: 'application-sender' }] };
      await r.put('applications', { ...next, updatedAt: now.toISOString() }); claimed.push(next);
      await audit(r, item.userId, 'APPLICATION_SUBMISSION_STARTED', item.id);
    }
    return claimed;
  });
  for (const item of claimed) {
    let providerAttempted = false;
    try {
      await read(async r => {
        const user = await r.get<User>('users', item.userId), job = await r.get<Job>('jobs', item.jobId);
        if (!user || user.disabled || user.role !== 'student' || !job || !isRecent(job)) throw new ApiError(409, 'JOB_UNAVAILABLE', 'Application eligibility changed.');
        const entitlements = await resolveStudentEntitlements(r, user, await configuredPlans(), now);
        const required = await prerequisites(r, user, job, entitlements, !!item.automated);
        const saved = item.snapshot as { cvVersion?: { id?: string } };
        const approvedCv = saved.cvVersion?.id ? await r.get<CvVersion>('cvVersions', saved.cvVersion.id) : null;
        if (!approvedCv || approvedCv.userId !== user.id || approvedCv.confirmed !== true) required.reasons.push('CONFIRMED_CV_REQUIRED');
        if (item.method === 'email' && job.email !== item.delivery?.destination) required.reasons.push('DESTINATION_UNVERIFIED');
        if (required.reasons.length) throw new ApiError(409, required.reasons[0], safeApplicationReason(required.reasons[0]));
      });
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
          const job = await r.get<Job>('jobs', item.jobId); if (!job || !isRecent(job)) throw new ApiError(409, 'JOB_UNAVAILABLE', 'Job is unavailable.');
          const fraud = await assessJob(r, job); if (fraud.riskLevel === 'high' || fraud.riskLevel === 'blocked') throw new ApiError(409, 'FRAUD_RISK', 'Job requires fraud review.');
          const at = new Date().toISOString();
          await r.put('applications', { ...current, status: 'DIRECT_SUBMITTED', updatedAt: at, submittedAt: at, submissionEvidence: 'platform', leaseOwner: undefined, leaseUntil: undefined, events: [...current.events, { status: 'DIRECT_SUBMITTED', at, actorId: 'application-scheduler' }] });
          await audit(r, item.userId, 'application.direct_submitted', item.id);
          await audit(r, item.userId, 'APPLICATION_SUBMITTED', item.id);
          await createNotificationRecord(r, { userId: current.employerId, type: 'application_status', title: 'New application', message: `A candidate applied to ${current.job.title}.`, href: '/employer/applicants', dedupeKey: `employer-application:${current.id}` });
        });
        continue;
      }
      const user = await read(r => r.get<User>('users', item.userId)); if (!user) throw new Error();
      const snapshot = item.snapshot as { rendered: { subject: string; text: string }; cvVersion: CvVersion; template?:ApplicationTemplate };
      const destination = item.delivery?.destination; if (!destination) throw new Error();
      const job = await read(r => r.get<Job>('jobs', item.jobId)); if (!job) throw new Error();
      const destinationRisk = await read(r => assessDestination(r, job)); if (destinationRisk.riskLevel !== 'low') throw new ApiError(409, 'FRAUD_RISK', 'Application destination requires review.');
      const providers = configuredCvProviders();
      const attachment = snapshot.template?.attachCv===false?undefined:snapshot.cvVersion.documentId && providers
        ? await downloadCv(user.id, snapshot.cvVersion.documentId, providers)
        : profileResumeAttachment(snapshot.cvVersion);
      if (attachment&&!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'].includes(attachment.contentType)) throw new Error();
      const currentPolicy = await read(async r => (await policy(r)).value);
      await rateLimit('application-provider:gmail', currentPolicy.providerPerMinute);
      await transaction(r => audit(r, item.userId, 'GMAIL_APPLICATION_SEND_STARTED', item.id));
      providerAttempted = true;
      const result = await send(user, { to: destination, subject: snapshot.rendered.subject, text: `${snapshot.rendered.text}\n\nJob reference: ${item.jobId}\nApplication reference: ${item.id}`, ...(attachment?{attachment: { ...attachment, contentType: attachment.contentType as 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'text/plain' }}:{}) });
      if (!result.accepted || !result.providerMessageId) throw new Error('Missing submission evidence');
      await transaction(async r => { const current = await r.get<ApplicationRecord>('applications', item.id); if (current?.leaseOwner !== owner) return; const at = new Date().toISOString(); await r.put('applications', { ...current, status: 'SENT', submittedAt: at, sentAt: at, updatedAt: at, submissionEvidence: 'provider', providerMessageId: result.providerMessageId, leaseOwner: undefined, leaseUntil: undefined, events: [...current.events, { status: 'SENT', at, actorId: 'application-sender' }] }); await audit(r, item.userId, 'application.sent', item.id); await audit(r, item.userId, 'GMAIL_APPLICATION_SENT', item.id); await audit(r, item.userId, 'APPLICATION_SUBMITTED', item.id); });
    } catch (error) {
      await transaction(async r => {
        const current = await r.get<ApplicationRecord>('applications', item.id); if (current?.leaseOwner !== owner) return;
        const knownRejected = error instanceof ApiError && ['MAIL_SEND_FAILED','MAIL_AUTH_REQUIRED','MAILBOX_NOT_CONNECTED','MAIL_RATE_LIMITED','MAIL_CONFIGURATION_REQUIRED','RATE_LIMIT'].includes(error.code);
        const uncertain = providerAttempted && !knownRejected;
        const reasonCode = uncertain ? 'MAIL_SEND_UNCERTAIN' : error instanceof ApiError ? error.code : 'MAIL_SEND_FAILED';
        const status: ApplicationStatus = uncertain || (error instanceof ApiError && error.status === 409) ? 'NEEDS_REVIEW' : 'FAILED';
        const at = new Date().toISOString(), released = uncertain ? current : await releaseApplicationCredits(r, current, at);
        await r.put('applications', { ...released, status, updatedAt: at, lastErrorCode: reasonCode, leaseOwner: undefined, leaseUntil: undefined, events: [...current.events, { status, at, actorId: 'application-sender', reasonCode }] });
        await audit(r, item.userId, status === 'NEEDS_REVIEW' ? 'APPLICATION_NEEDS_REVIEW' : 'APPLICATION_FAILED', item.id);
        if (item.method === 'email') await audit(r, item.userId, 'GMAIL_APPLICATION_FAILED', item.id);
      });
    }
  }
  return { processed: claimed.length };
}
