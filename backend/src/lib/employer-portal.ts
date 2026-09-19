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
import { assessEmployer } from './fraud-detection.js';
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
const jobUpdateSchema = jobBaseSchema.partial().extend({ expectedRevision: z.number().int().min(0) }).strict();
const applicantNoteSchema = z.object({ note: z.string().trim().min(1).max(2000) }).strict();

async function employerUser(r: Repository, actorId: string) {
  const user = await r.get<User>('users', actorId);
  if (!user || user.disabled || user.role !== 'employer') throw new ApiError(403, 'FORBIDDEN', 'An employer account is required.');
  return user;
}

function safeEmployer(row: EmployerRecord | null) {
  return row;
}

export async function createEmployerProfile(actorId: string, input: unknown, now = new Date()) {
  const value = employerSchema.parse(input);
  return transaction(async r => {
    await employerUser(r, actorId);
    if (await r.get('employers', actorId)) throw new ApiError(409, 'EMPLOYER_EXISTS', 'The company profile already exists.');
    const domainOwner = (await r.find<EmployerRecord>('employers', { domain: value.domain }, 1))[0];
    if (domainOwner) throw new ApiError(409, 'DOMAIN_IN_USE', 'This company domain is already registered.');
    const record: EmployerRecord = { id: actorId, ownerId: actorId, ...value, status: 'pending', revision: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    await r.put('employers', record);
    await r.put('entityRiskAssessments', await assessEmployer(r, record));
    await r.put('employerVerifications', { id: actorId, employerId: actorId, status: 'pending', revision: 0, evidence: [], history: [{ status: 'pending', actorId, at: now.toISOString() }], createdAt: now.toISOString(), updatedAt: now.toISOString() } satisfies EmployerVerification);
    await audit(r, actorId, 'employer.registered', actorId);
    return safeEmployer(record);
  });
}

export async function getEmployerProfile(actorId: string) {
  return read(async r => { await employerUser(r, actorId); return safeEmployer(await r.get<EmployerRecord>('employers', actorId)); });
}

export async function updateEmployerProfile(actorId: string, input: unknown, now = new Date()) {
  const { expectedRevision, ...change } = updateEmployerSchema.parse(input);
  return transaction(async r => {
    await employerUser(r, actorId);
    const current = await r.get<EmployerRecord>('employers', actorId);
    if (!current) throw new ApiError(404, 'EMPLOYER_NOT_FOUND', 'Create the company profile first.');
    if (current.revision !== expectedRevision) throw new ApiError(409, 'EMPLOYER_PROFILE_CONFLICT', 'Reload the company profile before saving.');
    if (change.domain && change.domain !== current.domain) {
      const owner = (await r.find<EmployerRecord>('employers', { domain: change.domain }, 1))[0];
      if (owner && owner.id !== actorId) throw new ApiError(409, 'DOMAIN_IN_USE', 'This company domain is already registered.');
    }
    const identityChanged = (change.domain && change.domain !== current.domain) || (change.website && change.website !== current.website);
    const candidate = { ...current, ...change };
    const merged = employerSchema.parse({ name: candidate.name, domain: candidate.domain, country: candidate.country, description: candidate.description, website: candidate.website, industry: candidate.industry, companySize: candidate.companySize, headquarters: candidate.headquarters });
    const next: EmployerRecord = { ...current, ...merged, status: identityChanged ? 'pending' : current.status, revision: current.revision + 1, updatedAt: now.toISOString(), ...(identityChanged ? { verifiedAt: undefined, verifiedBy: undefined } : {}) };
    await r.put('employers', next);
    await r.put('entityRiskAssessments', await assessEmployer(r, next));
    if (identityChanged) {
      const verification = await r.get<EmployerVerification>('employerVerifications', actorId);
      await r.put('employerVerifications', { id: actorId, employerId: actorId, status: 'pending', revision: (verification?.revision ?? 0) + 1, evidence: [], history: [...(verification?.history ?? []), { status: 'pending', actorId, at: now.toISOString(), note: 'IDENTITY_CHANGED' }], createdAt: verification?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() });
    }
    await audit(r, actorId, 'employer.profile_updated', actorId);
    return safeEmployer(next);
  });
}

export async function getEmployerVerification(actorId: string) {
  return read(async r => { await employerUser(r, actorId); return r.get<EmployerVerification>('employerVerifications', actorId); });
}

export async function submitEmployerVerification(actorId: string, input: unknown, now = new Date()) {
  const value = evidenceSchema.parse(input);
  return transaction(async r => {
    await employerUser(r, actorId);
    const employer = await r.get<EmployerRecord>('employers', actorId);
    if (!employer) throw new ApiError(409, 'EMPLOYER_REQUIRED', 'Create the company profile first.');
    const current = await r.get<EmployerVerification>('employerVerifications', actorId);
    if ((current?.revision ?? 0) !== value.expectedRevision) throw new ApiError(409, 'VERIFICATION_CONFLICT', 'Reload verification before submitting evidence.');
    const evidence = value.evidence.map(item => ({ ...item, id: randomUUID(), submittedAt: now.toISOString() }));
    const next: EmployerVerification = { id: actorId, employerId: actorId, status: 'pending', revision: (current?.revision ?? 0) + 1, evidence: [...(current?.evidence ?? []), ...evidence], history: [...(current?.history ?? []), { status: 'pending', actorId, at: now.toISOString(), note: 'EVIDENCE_SUBMITTED' }], createdAt: current?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() };
    await r.put('employerVerifications', next);
    await r.put('employers', { ...employer, status: 'pending', revision: employer.revision + 1, updatedAt: now.toISOString() });
    await audit(r, actorId, 'employer.verification_requested', actorId);
    return next;
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
  return next;
}

export async function getEmployerJob(actorId: string, jobId: string) {
  return read(async r => { await employerUser(r, actorId); const job = await r.get<Job>('jobs', jobId); if (!job || job.employerId !== actorId) throw new ApiError(404, 'NOT_FOUND', 'Job not found.'); return job; });
}

export async function updateEmployerJob(actorId: string, jobId: string, input: unknown, now = new Date()) {
  const { expectedRevision, ...change } = jobUpdateSchema.parse(input);
  return transaction(async r => {
    await employerUser(r, actorId);
    const job = await r.get<Job & { revision?: number }>('jobs', jobId);
    if (!job || job.employerId !== actorId) throw new ApiError(404, 'NOT_FOUND', 'Job not found.');
    if ((job.revision ?? 0) !== expectedRevision) throw new ApiError(409, 'JOB_CONFLICT', 'Reload the job before saving.');
    if (['closed', 'disabled'].includes(job.status)) throw new ApiError(409, 'JOB_NOT_EDITABLE', 'Closed or removed jobs cannot be edited.');
    const employer = await r.get<EmployerRecord>('employers', actorId);
    if (!employer) throw new ApiError(409, 'EMPLOYER_REQUIRED', 'Create the company profile first.');
    const parsed = jobSchema.parse({ ...job, ...change });
    const next = { ...job, ...parsed, company: employer.name, domain: employer.domain, status: 'review' as const, trust: 'pending' as const, revision: (job.revision ?? 0) + 1, updatedAt: now.toISOString() };
    await r.put('jobs', next);
    await audit(r, actorId, 'job.review_requested', jobId);
    return next;
  });
}

export async function closeEmployerJob(actorId: string, jobId: string) {
  return transaction(async r => { await employerUser(r, actorId); const job = await r.get<Job>('jobs', jobId); if (!job || job.employerId !== actorId) throw new ApiError(404, 'NOT_FOUND', 'Job not found.'); const closed = await transitionJobLifecycle(r, jobId, 'closed', actorId, 'EMPLOYER_CLOSED'); await audit(r, actorId, 'job.closed', jobId); return closed; });
}

export async function listEmployerApplicants(actorId: string, filters: { jobId?: string; status?: ApplicationStatus } = {}) {
  return read(async r => {
    await employerUser(r, actorId);
    if (filters.jobId) { const job = await r.get<Job>('jobs', filters.jobId); if (!job || job.employerId !== actorId) throw new ApiError(404, 'NOT_FOUND', 'Job not found.'); }
    const query: Record<string, unknown> = { employerId: actorId, ...(filters.jobId ? { jobId: filters.jobId } : {}), ...(filters.status ? { status: filters.status } : {}) };
    return (await r.find<ApplicationRecord>('applications', query, 500)).filter(row => row.method === 'direct' && !['QUEUED', 'SENDING'].includes(row.status)).map(employerApplication);
  });
}

export async function getEmployerApplicant(actorId: string, applicationId: string) {
  return read(async r => { await employerUser(r, actorId); const row = await r.get<ApplicationRecord>('applications', applicationId); if (!row || row.employerId !== actorId || row.method !== 'direct') throw new ApiError(404, 'NOT_FOUND', 'Application not found.'); return employerApplication(row); });
}

export async function addApplicantNote(actorId: string, applicationId: string, input: unknown, now = new Date()) {
  const { note } = applicantNoteSchema.parse(input);
  return transaction(async r => {
    await employerUser(r, actorId); const application = await r.get<ApplicationRecord>('applications', applicationId);
    if (!application || application.employerId !== actorId || application.method !== 'direct') throw new ApiError(404, 'NOT_FOUND', 'Application not found.');
    const row = { id: randomUUID(), employerId: actorId, applicationId, note, createdBy: actorId, createdAt: now.toISOString() };
    await r.put('employerApplicantNotes', row); await audit(r, actorId, 'applicant.note_added', applicationId); return row;
  });
}

export async function listApplicantNotes(actorId: string, applicationId: string) {
  return read(async r => { await employerUser(r, actorId); const application = await r.get<ApplicationRecord>('applications', applicationId); if (!application || application.employerId !== actorId || application.method !== 'direct') throw new ApiError(404, 'NOT_FOUND', 'Application not found.'); return (await r.find<{ createdAt: string }>('employerApplicantNotes', { employerId: actorId, applicationId }, 200)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); });
}

export async function updateApplicantStatus(actorId: string, applicationId: string, status: ApplicationStatus, expectedStatus?: ApplicationStatus, now = new Date()) {
  return transaction(async r => {
    await employerUser(r, actorId); const application = await r.get<ApplicationRecord>('applications', applicationId);
    if (!application || application.employerId !== actorId || application.method !== 'direct') throw new ApiError(404, 'NOT_FOUND', 'Application not found.');
    if (expectedStatus && application.status !== expectedStatus) throw new ApiError(409, 'APPLICANT_CONFLICT', 'Reload the application before updating it.');
    if (!canTransition(application.status, status)) throw new ApiError(409, 'INVALID_TRANSITION', 'Invalid applicant status transition.');
    const next = { ...application, status, events: [...application.events, { status, at: now.toISOString(), actorId }] };
    await r.put('applications', next); await audit(r, actorId, 'applicant.' + status.toLowerCase(), applicationId); return employerApplication(next);
  });
}
