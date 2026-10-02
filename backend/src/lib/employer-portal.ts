import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApplicationStatus, Job, User } from './domain.js';
import { canTransition } from './domain.js';
import type { ApplicationRecord } from './application-engine.js';
import { employerApplication } from './application-engine.js';
import type { Repository } from './store.js';
import { read, transaction } from './store.js';
import { ApiError, audit } from './security.js';
import { employerBaseSchema, employerSchema, jobBaseSchema, jobSchema } from './schemas.js';
import { createNotificationRecord } from './notification-platform.js';
import { assessEmployer } from './fraud-detection.js';
import { validateTaxonomyReferences } from './student-catalog.js';
import { transitionJobLifecycle } from './lifecycle.js';

export type EmployerRecord = z.infer<typeof employerSchema> & {
  id: string; ownerId: string; status: 'pending' | 'verified' | 'rejected'; revision: number;
  createdAt: string; updatedAt: string; verifiedAt?: string; verifiedBy?: string;
};
type VerificationEvidence = { id: string; type: 'domain' | 'website' | 'trusted_source' | 'direct_evidence'; reference: string; submittedAt: string };
export type EmployerVerification = {
  id: string; employerId: string; status: 'pending' | 'verified' | 'rejected'; revision: number;
  evidence: VerificationEvidence[]; history: { status: string; actorId: string; at: string; note?: string }[];
  createdAt: string; updatedAt: string;
};

const updateEmployerSchema = employerBaseSchema.partial().extend({ expectedRevision: z.number().int().min(0) }).strict();
export const evidenceSchema = z.object({
  expectedRevision: z.number().int().min(0),
  evidence: z.array(z.object({
    type: z.enum(['domain', 'website', 'trusted_source', 'direct_evidence']),
    reference: z.string().trim().min(3).max(500),
  }).strict()).min(1).max(20),
}).strict();
const jobUpdateSchema = jobBaseSchema.partial().extend({ expectedRevision: z.number().int().min(0), submission: z.enum(['draft', 'review']).default('review') }).strict();
const applicantNoteSchema = z.object({ note: z.string().trim().min(1).max(2000) }).strict();

async function employerUser(r: Repository, actorId: string) {
  const user = await r.get<User>('users', actorId);
  if (!user || user.disabled || user.role !== 'employer') throw new ApiError(403, 'FORBIDDEN', 'An employer account is required.');
  return user;
}

async function ownedCompany(r: Repository, actorId: string) {
  const direct = await r.get<EmployerRecord>('employers', actorId);
  if (direct?.ownerId === actorId) return direct;
  return (await r.find<EmployerRecord>('employers', { ownerId: actorId }, 1))[0] ?? null;
}
async function ownershipIds(r: Repository, actorId: string) {
  const company = await ownedCompany(r, actorId);
  return company ? [...new Set([actorId, company.id])] : [actorId];
}
async function ownsJob(r: Repository, actorId: string, job: Job | null) {
  return !!job && (await ownershipIds(r, actorId)).includes(job.employerId);
}
async function ownsApplicant(r: Repository, actorId: string, row: ApplicationRecord | null) {
  return !!row && row.method === 'direct' && !['QUEUED','SENDING','FAILED','NEEDS_REVIEW'].includes(row.status) && (await ownershipIds(r, actorId)).includes(row.employerId) && await ownsJob(r, actorId, await r.get<Job>('jobs', row.jobId));
}
async function applicantScope(r: Repository, actorId: string) {
  const employerId = { $in: await ownershipIds(r, actorId) }, jobIds: string[] = [];
  let after = '';
  while (true) {
    const batch = await r.scan<Job>('jobs', { employerId }, after, 500);
    jobIds.push(...batch.map(job => job.id));
    if (batch.length < 500) break;
    after = batch.at(-1)!.id;
  }
  return { employerId, jobId: { $in: jobIds }, method: 'direct', status: { $nin: ['QUEUED','SENDING','FAILED','NEEDS_REVIEW'] } };
}
function safeJob(job: Job): Job {
  const fields = [...Object.keys(jobBaseSchema.shape), 'id','company','domain','employerId','status','trust','revision','source','discoveredAt','expiresAt','updatedAt'];
  return Object.fromEntries(fields.filter(key => key in job).map(key => [key, (job as unknown as Record<string, unknown>)[key]])) as Job;
}
function safeEmployer(row: EmployerRecord | null) {
  if (!row) return null;
  const { id, ownerId, name, domain, country, description, website, industry, companySize, headquarters, status, revision, createdAt, updatedAt, verifiedAt } = row;
  return { id, ownerId, name, domain, country, description, website, industry, companySize, headquarters, status, revision, createdAt, updatedAt, verifiedAt };
}

export async function createEmployerProfile(actorId: string, input: unknown, now = new Date()) {
  const value = employerSchema.parse(input);
  return transaction(async r => {
    await employerUser(r, actorId);
    if (await ownedCompany(r, actorId)) throw new ApiError(409, 'EMPLOYER_EXISTS', 'The company profile already exists.');
    const domainOwner = (await r.find<EmployerRecord>('employers', { domain: value.domain }, 1))[0];
    if (domainOwner) throw new ApiError(409, 'DOMAIN_IN_USE', 'This company domain is already registered.');
    const record: EmployerRecord = { id: actorId, ownerId: actorId, ...value, status: 'pending', revision: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    await r.put('employers', record);
    await r.put('entityRiskAssessments', await assessEmployer(r, record));
    await r.put('employerVerifications', { id: actorId, employerId: actorId, status: 'pending', revision: 0, evidence: [], history: [{ status: 'pending', actorId, at: now.toISOString() }], createdAt: now.toISOString(), updatedAt: now.toISOString() } satisfies EmployerVerification);
    await audit(r, actorId, 'employer.registered', actorId);
    return safeEmployer(record)!;
  });
}

export async function getEmployerProfile(actorId: string) {
  return read(async r => { await employerUser(r, actorId); return safeEmployer(await ownedCompany(r, actorId)); });
}

export async function updateEmployerProfile(actorId: string, input: unknown, now = new Date()) {
  const { expectedRevision, ...parsedChange } = updateEmployerSchema.parse(input);
  const change = Object.fromEntries(Object.entries(parsedChange).filter(([key]) => Object.prototype.hasOwnProperty.call(input, key))) as typeof parsedChange;
  return transaction(async r => {
    await employerUser(r, actorId);
    const current = await ownedCompany(r, actorId);
    if (!current) throw new ApiError(404, 'EMPLOYER_NOT_FOUND', 'Create the company profile first.');
    if (current.revision !== expectedRevision) throw new ApiError(409, 'EMPLOYER_PROFILE_CONFLICT', 'Reload the company profile before saving.');
    if (change.domain && change.domain !== current.domain) {
      const owner = (await r.find<EmployerRecord>('employers', { domain: change.domain }, 1))[0];
      if (owner && owner.id !== current.id) throw new ApiError(409, 'DOMAIN_IN_USE', 'This company domain is already registered.');
    }
    const identityChanged = (change.domain && change.domain !== current.domain) || ('website' in change && (change.website || '') !== (current.website || ''));
    const candidate = { ...current, ...change };
    const merged = employerSchema.parse({ name: candidate.name, domain: candidate.domain, country: candidate.country, description: candidate.description, website: candidate.website || undefined, industry: candidate.industry, companySize: candidate.companySize, headquarters: candidate.headquarters });
    const next: EmployerRecord = { ...current, ...merged, status: identityChanged ? 'pending' : current.status, revision: current.revision + 1, updatedAt: now.toISOString(), ...(identityChanged ? { verifiedAt: undefined, verifiedBy: undefined } : {}) };
    await r.put('employers', next);
    await r.put('entityRiskAssessments', await assessEmployer(r, next));
    if (identityChanged) {
      const verification = await r.get<EmployerVerification>('employerVerifications', (await ownedCompany(r, actorId))?.id || actorId);
      await r.put('employerVerifications', { id: current.id, employerId: current.id, status: 'pending', revision: (verification?.revision ?? 0) + 1, evidence: [], history: [...(verification?.history ?? []), { status: 'pending', actorId, at: now.toISOString(), note: 'IDENTITY_CHANGED' }], createdAt: verification?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() });
    }
    await audit(r, actorId, 'employer.profile_updated', actorId);
    return safeEmployer(next)!;
  });
}

export async function getEmployerVerification(actorId: string) {
  return read(async r => { await employerUser(r, actorId); const row = await r.get<EmployerVerification>('employerVerifications', (await ownedCompany(r, actorId))?.id || actorId); return row ? { id: row.id, revision: row.revision, status: row.status, evidence: row.evidence, updatedAt: row.updatedAt } : null; });
}

export async function submitEmployerVerification(actorId: string, input: unknown, now = new Date()) {
  const value = evidenceSchema.parse(input);
  return transaction(async r => {
    await employerUser(r, actorId);
    const employer = await ownedCompany(r, actorId);
    if (!employer) throw new ApiError(409, 'EMPLOYER_REQUIRED', 'Create the company profile first.');
    const current = await r.get<EmployerVerification>('employerVerifications', (await ownedCompany(r, actorId))?.id || actorId);
    if ((current?.revision ?? 0) !== value.expectedRevision) throw new ApiError(409, 'VERIFICATION_CONFLICT', 'Reload verification before submitting evidence.');
    const evidence = value.evidence.map(item => ({ ...item, id: randomUUID(), submittedAt: now.toISOString() }));
    const next: EmployerVerification = { id: employer.id, employerId: employer.id, status: 'pending', revision: (current?.revision ?? 0) + 1, evidence: [...(current?.evidence ?? []), ...evidence], history: [...(current?.history ?? []), { status: 'pending', actorId, at: now.toISOString(), note: 'EVIDENCE_SUBMITTED' }], createdAt: current?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() };
    await r.put('employerVerifications', next);
    await r.put('employers', { ...employer, status: 'pending', revision: employer.revision + 1, updatedAt: now.toISOString() });
    await audit(r, actorId, 'employer.verification_requested', actorId);
    return { id: next.id, revision: next.revision, status: next.status, evidence: next.evidence, updatedAt: next.updatedAt };
  });
}

export async function recordEmployerVerificationDecision(r: Repository, employerId: string, actorId: string, status: 'verified' | 'rejected' | 'pending', note: string | undefined, now = new Date()) {
  const employer = await r.get<EmployerRecord>('employers', employerId);
  if (!employer) throw new ApiError(404, 'NOT_FOUND', 'Employer not found.');
  const current = await r.get<EmployerVerification>('employerVerifications', employerId);
  if (status === 'verified' && !(current?.evidence.length)) throw new ApiError(409, 'VERIFICATION_EVIDENCE_REQUIRED', 'Verification evidence is required.');
  const next: EmployerVerification = { id: employerId, employerId, status, revision: (current?.revision ?? 0) + 1, evidence: current?.evidence ?? [], history: [...(current?.history ?? []), { status, actorId, at: now.toISOString(), ...(note ? { note } : {}) }], createdAt: current?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() };
  await r.put('employerVerifications', next);
  await r.put('employers', { ...employer, status, revision: (employer.revision ?? 0) + 1, updatedAt: now.toISOString(), ...(status === 'verified' ? { verifiedAt: now.toISOString(), verifiedBy: actorId } : {}) });
  await audit(r, actorId, `employer.${status}`, employerId);
  await createNotificationRecord(r, { userId: employer.ownerId, type: 'system', title: 'Company verification updated', message: `Your company verification status is ${status}.`, href: '/employer/organization', dedupeKey: `employer-verification:${employerId}:${next.revision}` }, now);
  return next;
}

export async function getEmployerJob(actorId: string, jobId: string) {
  return read(async r => { await employerUser(r, actorId); const job = await r.get<Job>('jobs', jobId); if (!job || !(await ownsJob(r, actorId, job))) throw new ApiError(404, 'NOT_FOUND', 'Job not found.'); return safeJob(job); });
}

export async function updateEmployerJob(actorId: string, jobId: string, input: unknown, now = new Date()) {
  const { expectedRevision, submission, ...parsedChange } = jobUpdateSchema.parse(input);
  const change = Object.fromEntries(Object.entries(parsedChange).filter(([key]) => Object.prototype.hasOwnProperty.call(input, key))) as typeof parsedChange;
  return transaction(async r => {
    await employerUser(r, actorId);
    const job = await r.get<Job & { revision?: number }>('jobs', jobId);
    if (!job || !(await ownsJob(r, actorId, job))) throw new ApiError(404, 'NOT_FOUND', 'Job not found.');
    if ((job.revision ?? 0) !== expectedRevision) throw new ApiError(409, 'JOB_CONFLICT', 'Reload the job before saving.');
    if (['closed', 'disabled'].includes(job.status)) throw new ApiError(409, 'JOB_NOT_EDITABLE', 'Closed or removed jobs cannot be edited.');
    const employer = await ownedCompany(r, actorId);
    if (!employer) throw new ApiError(409, 'EMPLOYER_REQUIRED', 'Create the company profile first.');
    if (submission === 'draft' && job.status !== 'draft') throw new ApiError(409, 'JOB_NOT_DRAFT', 'Only drafts can be saved as drafts.');
    const parsed = jobSchema.parse({ ...job, ...change });
    await validateTaxonomyReferences(r, { occupationId: parsed.matching?.occupationId, locationId: parsed.matching?.locationId });
    const next = { ...job, ...parsed, lifecycle: { schemaVersion: 1 as const, state: 'publishing' as const, revision: (job.lifecycle?.revision ?? 0) + 1, changedAt: now.toISOString(), reasonCode: submission === 'draft' ? 'EMPLOYER_DRAFT' : 'EMPLOYER_SUBMITTED' }, company: employer.name, domain: employer.domain, status: submission, trust: 'pending' as const, revision: (job.revision ?? 0) + 1, updatedAt: now.toISOString() };
    await r.put('jobs', next);
    await audit(r, actorId, submission === 'draft' ? 'job.draft_saved' : 'job.review_requested', jobId);
    return safeJob(next);
  });
}

export async function closeEmployerJob(actorId: string, jobId: string) {
  return transaction(async r => { await employerUser(r, actorId); const job = await r.get<Job>('jobs', jobId); if (!job || !(await ownsJob(r, actorId, job))) throw new ApiError(404, 'NOT_FOUND', 'Job not found.'); const closed = await transitionJobLifecycle(r, jobId, 'closed', actorId, 'EMPLOYER_CLOSED'); await audit(r, actorId, 'job.closed', jobId); return safeJob(closed); });
}

export async function listEmployerApplicants(actorId: string, filters: { jobId?: string; status?: ApplicationStatus } = {}) {
  return read(async r => {
    await employerUser(r, actorId);
    if (filters.jobId) { const job = await r.get<Job>('jobs', filters.jobId); if (!job || !(await ownsJob(r, actorId, job))) throw new ApiError(404, 'NOT_FOUND', 'Job not found.'); }
    const query: Record<string, unknown> = { ...await applicantScope(r, actorId), ...(filters.jobId ? { jobId: filters.jobId } : {}), ...(filters.status ? { status: filters.status } : {}) };
    const rows = await r.find<ApplicationRecord>('applications', query, 500);
    const visible = await Promise.all(rows.map(async row => await ownsApplicant(r, actorId, row) ? row : null));
    return visible.filter((row): row is ApplicationRecord => row !== null).map(employerApplication);
  });
}

export async function getEmployerApplicant(actorId: string, applicationId: string) {
  return read(async r => { await employerUser(r, actorId); const row = await r.get<ApplicationRecord>('applications', applicationId); if (!row || !(await ownsApplicant(r, actorId, row))) throw new ApiError(404, 'NOT_FOUND', 'Application not found.'); return employerApplication(row); });
}

export async function addApplicantNote(actorId: string, applicationId: string, input: unknown, now = new Date()) {
  const { note } = applicantNoteSchema.parse(input);
  return transaction(async r => {
    await employerUser(r, actorId); const application = await r.get<ApplicationRecord>('applications', applicationId);
    if (!application || !(await ownsApplicant(r, actorId, application))) throw new ApiError(404, 'NOT_FOUND', 'Application not found.');
    const row = { id: randomUUID(), employerId: actorId, applicationId, note, createdBy: actorId, createdAt: now.toISOString() };
    await r.put('employerApplicantNotes', row); await audit(r, actorId, 'applicant.note_added', applicationId); return row;
  });
}

export async function listApplicantNotes(actorId: string, applicationId: string) {
  return read(async r => { await employerUser(r, actorId); const application = await r.get<ApplicationRecord>('applications', applicationId); if (!application || !(await ownsApplicant(r, actorId, application))) throw new ApiError(404, 'NOT_FOUND', 'Application not found.'); return (await r.find<{ createdAt: string }>('employerApplicantNotes', { employerId: actorId, applicationId }, 200)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); });
}

export async function updateApplicantStatus(actorId: string, applicationId: string, status: ApplicationStatus, expectedStatus?: ApplicationStatus, now = new Date()) {
  return transaction(async r => {
    await employerUser(r, actorId); const application = await r.get<ApplicationRecord>('applications', applicationId);
    if (!application || !(await ownsApplicant(r, actorId, application))) throw new ApiError(404, 'NOT_FOUND', 'Application not found.');
    if (expectedStatus && application.status !== expectedStatus) throw new ApiError(409, 'APPLICANT_CONFLICT', 'Reload the application before updating it.');
    if (!canTransition(application.status, status)) throw new ApiError(409, 'INVALID_TRANSITION', 'Invalid applicant status transition.');
    const next = { ...application, status, events: [...application.events, { status, at: now.toISOString(), actorId }] };
    await r.put('applications', next); await audit(r, actorId, 'applicant.' + status.toLowerCase(), applicationId);
    await createNotificationRecord(r, { userId: application.userId, type: 'application_status', title: 'An employer updated your application', message: `${application.job.title}: ${status.replaceAll('_', ' ')}`, href: '/applications', dedupeKey: `applicant:${applicationId}:${next.events.length}` }, now);
    return employerApplication(next);
  });
}


/** Uses the existing job record and moderation lifecycle, never direct publication. */
export async function createEmployerJob(actorId: string, input: unknown, now = new Date()) {
  const { submission, ...fields } = jobBaseSchema.extend({ submission: z.enum(['draft', 'review']).default('review') }).strict().parse(input);
  const parsed = jobSchema.parse(fields);
  return transaction(async r => {
    await employerUser(r, actorId);
    const org = await ownedCompany(r, actorId);
    if (!org) throw new ApiError(409, 'ORG_REQUIRED', 'Create a company profile first.');
    await validateTaxonomyReferences(r, { occupationId: parsed.matching?.occupationId, locationId: parsed.matching?.locationId });
    const job = { ...parsed, id: randomUUID(), company: org.name, domain: org.domain, employerId: actorId,
      status: submission, trust: 'pending' as const, source: 'Employer submission', revision: 0,
      discoveredAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 90 * 86400000).toISOString(),
      lifecycle: { schemaVersion: 1 as const, state: 'publishing' as const, revision: 0, changedAt: now.toISOString(), reasonCode: submission === 'draft' ? 'EMPLOYER_DRAFT' : 'EMPLOYER_SUBMITTED' } };
    await r.put('jobs', job);
    await audit(r, actorId, submission === 'draft' ? 'job.draft_saved' : 'job.review_requested', job.id);
    return safeJob(job);
  });
}

const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), q: z.string().trim().max(200).default(''), status: z.string().max(40).default(''), jobId: z.string().max(200).default('') });
export async function employerPage(actorId: string, resource: 'jobs' | 'applicants', input: unknown) {
  const filters = pageSchema.parse(input), limit = 20;
  return read(async r => {
    await employerUser(r, actorId);
    const query: Record<string, unknown> = resource === 'applicants' ? await applicantScope(r, actorId) : { employerId: { $in: await ownershipIds(r, actorId) } };
    if (resource === 'applicants') query.method = 'direct';
    if (filters.status) {
      const allowed = resource === 'jobs' ? ['draft','review','published','closed','disabled','expired'] : ['DIRECT_SUBMITTED','VIEWED','SHORTLISTED','INTERVIEW','OFFER','REJECTED','WITHDRAWN'];
      if (!allowed.includes(filters.status)) throw new ApiError(400, 'INVALID_STATUS', 'Invalid status filter.');
      if (filters.status === 'expired') query.expiresAt = { $lte: new Date().toISOString() };
      else query.status = filters.status;
    } else if (resource === 'applicants') query.status = { $nin: ['QUEUED','SENDING','FAILED','NEEDS_REVIEW'] };
    if (filters.jobId && resource === 'applicants') {
      const job = await r.get<Job>('jobs', filters.jobId);
      if (!job || !(await ownsJob(r, actorId, job))) throw new ApiError(404, 'NOT_FOUND', 'Job not found.');
      query.jobId = filters.jobId;
    }
    if (filters.q) {
      const escaped = filters.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = (resource === 'jobs' ? ['title','city'] : ['snapshot.profile.name','snapshot.profile.skills','job.title']).map(field => ({ [field]: { $regex: escaped, $options: 'i' } }));
    }
    const collection = resource === 'jobs' ? 'jobs' : 'applications';
    const total = await r.count(collection, query), pages = Math.max(1, Math.ceil(total / limit)), page = Math.min(filters.page, pages);
    const rows = await r.page<any>(collection, query, { [resource === 'jobs' ? 'discoveredAt' : 'createdAt']: -1, id: 1 }, (page - 1) * limit, limit);
    const visible = resource === 'jobs' ? rows.map(safeJob) : (await Promise.all(rows.map(async row => await ownsApplicant(r, actorId, row) ? employerApplication(row) : null))).filter(row => row !== null);
    return { items: visible, total, page, pages };
  });
}

export async function employerOverview(actorId: string, now = new Date()) {
  return read(async r => {
    await employerUser(r, actorId);
    const jobs = { employerId: { $in: await ownershipIds(r, actorId) } }, apps = await applicantScope(r, actorId);
    const [active, draft, review, closed, expired, applications, fresh, shortlisted, interviews, offers] = await Promise.all([
      r.count('jobs', { ...jobs, status: 'published', expiresAt: { $gt: now.toISOString() } }),
      r.count('jobs', { ...jobs, status: 'draft' }), r.count('jobs', { ...jobs, status: 'review' }),
      r.count('jobs', { ...jobs, status: 'closed' }), r.count('jobs', { ...jobs, expiresAt: { $lte: now.toISOString() } }),
      r.count('applications', apps), ...['DIRECT_SUBMITTED','SHORTLISTED','INTERVIEW','OFFER'].map(status => r.count('applications', { ...apps, status }))
    ]);
    return { counts: { active, draft, review, closed, expired, applications, newApplications: fresh, shortlisted, interviews, offers },
      recentJobs: (await r.page<Job>('jobs', jobs, { updatedAt: -1, id: 1 }, 0, 5)).map(safeJob),
      recentApplications: (await r.page<ApplicationRecord>('applications', apps, { createdAt: -1, id: 1 }, 0, 5)).map(employerApplication),
      subscription: { available: false, reason: 'Employer billing and entitlements are not configured. Candidate plans do not grant employer allowances.' } };
  });
}


export async function listEmployerJobs(actorId: string) {
  return read(async r => { await employerUser(r, actorId); return (await r.find<Job>('jobs', { employerId: { $in: await ownershipIds(r, actorId) } })).map(safeJob); });
}
