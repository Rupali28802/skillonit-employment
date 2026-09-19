import { z } from 'zod';
import type { Job, User } from './domain.js';
import type { ApplicationRecord } from './application-engine.js';
import { publicApplication } from './application-engine.js';
import type { EmployerRecord, EmployerVerification } from './employer-portal.js';
import { recordEmployerVerificationDecision } from './employer-portal.js';
import { persistJobFraudAssessment } from './fraud-detection.js';
import { transitionJobLifecycle } from './lifecycle.js';
import { updateJobSource } from './job-source-strategy.js';
import { read, transaction, type Repository, type Row } from './store.js';
import { ApiError, audit, safeUser } from './security.js';
import { revokeSessions } from './auth-lifecycle.js';

type AdminList = { items: unknown[]; nextCursor: string | null };
type AuditRecord = Row & { actorId?: string; action?: string; entityId?: string; createdAt?: string };

const pageSchema = z.object({
  cursor: z.string().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().max(40).optional(),
  role: z.enum(['student', 'employer', 'admin']).optional(),
  query: z.string().trim().max(100).optional(),
}).strict();
const userStateSchema = z.object({ disabled: z.boolean(), reason: z.string().trim().min(3).max(500) }).strict();
const verificationSchema = z.object({ status: z.enum(['verified', 'rejected', 'pending']), note: z.string().trim().min(3).max(2000).optional() }).strict();
const moderationSchema = z.object({ action: z.enum(['publish', 'review', 'close', 'remove']), reason: z.string().trim().min(3).max(500) }).strict();
const fraudReviewSchema = z.object({ status: z.enum(['resolved', 'rejected']), note: z.string().trim().min(3).max(1000) }).strict();

async function requireAdmin(r: Repository, actor: User) {
  const current = await r.get<User>('users', actor.id);
  if (!current || current.disabled || current.role !== 'admin')
    throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
  return current;
}

function page<T extends { id: string }>(rows: T[], input: z.infer<typeof pageSchema>): { items: T[]; nextCursor: string | null } {
  const sorted = rows.filter(row => row.id > input.cursor).sort((a, b) => a.id.localeCompare(b.id));
  const items = sorted.slice(0, input.limit);
  return { items, nextCursor: sorted.length > input.limit ? items.at(-1)?.id ?? null : null };
}

function matchesQuery(row: Record<string, unknown>, query?: string) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return ['id', 'email', 'name', 'company', 'title', 'domain'].some(key => String(row[key] ?? '').toLowerCase().includes(needle));
}

function safePayment(row: Row) {
  const { providerPaymentId: _payment, providerOrderId: _order, signature: _signature, ...safe } = row;
  return safe;
}

async function listRows(actor: User, collection: string, params: URLSearchParams, transform: (row: any) => unknown = row => row): Promise<AdminList> {
  const input = pageSchema.parse(Object.fromEntries(params));
  return read(async r => {
    await requireAdmin(r, actor);
    let rows = await r.find<Row>(collection, {}, 1000);
    if (input.status) rows = rows.filter(row => row.status === input.status);
    if (input.role) rows = rows.filter(row => row.role === input.role);
    rows = rows.filter(row => matchesQuery(row, input.query));
    const result = page(rows, input);
    return { ...result, items: result.items.map(transform) };
  });
}

export async function adminOverview(actor: User) {
  return read(async r => {
    await requireAdmin(r, actor);
    const counts = Object.fromEntries(await Promise.all([
      'users', 'employers', 'jobs', 'jobSources', 'applications', 'payments', 'fraudReports', 'auditLogs',
    ].map(async name => [name, await r.count(name)])));
    const pending = {
      employers: await r.count('employers', { status: 'pending' }),
      jobs: await r.count('jobs', { status: 'review' }),
      fraudReports: await r.count('fraudReports', { status: 'pending' }),
      refunds: await r.count('refundRequests', { status: 'pending' }),
    };
    return { counts, pending };
  });
}

export const listAdminUsers = (actor: User, params: URLSearchParams) => listRows(actor, 'users', params, (row: User) => safeUser(row));

export async function adminUser(actor: User, userId: string) {
  return read(async r => {
    await requireAdmin(r, actor);
    const user = await r.get<User>('users', userId);
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');
    const sessions = await r.count('sessions', { userId });
    return { user: safeUser(user), activeSessions: sessions };
  });
}

export async function setAdminUserState(actor: User, userId: string, input: unknown) {
  const value = userStateSchema.parse(input);
  if (actor.id === userId && value.disabled) throw new ApiError(409, 'SELF_DISABLE_FORBIDDEN', 'Administrators cannot disable their own account.');
  return transaction(async r => {
    await requireAdmin(r, actor);
    const user = await r.get<User>('users', userId);
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found.');
    if (user.role === 'admin' && value.disabled) {
      const activeAdmins = (await r.find<User>('users', { role: 'admin' }, 1000)).filter(item => !item.disabled);
      if (activeAdmins.length <= 1) throw new ApiError(409, 'LAST_ADMIN_REQUIRED', 'The final active administrator cannot be disabled.');
    }
    await r.put('users', { ...user, disabled: value.disabled });
    if (value.disabled) await revokeSessions(r, userId);
    await audit(r, actor.id, value.disabled ? 'admin.user_disabled' : 'admin.user_enabled', userId);
    return { user: safeUser({ ...user, disabled: value.disabled }), sessionsRevoked: value.disabled };
  });
}

export const listAdminEmployers = (actor: User, params: URLSearchParams) => listRows(actor, 'employers', params);
export async function adminEmployer(actor: User, employerId: string) {
  return read(async r => {
    await requireAdmin(r, actor);
    const employer = await r.get<EmployerRecord>('employers', employerId);
    if (!employer) throw new ApiError(404, 'EMPLOYER_NOT_FOUND', 'Employer not found.');
    return { employer, verification: await r.get<EmployerVerification>('employerVerifications', employerId), risk: await r.get('entityRiskAssessments', `employer:${employerId}`) };
  });
}
export async function verifyAdminEmployer(actor: User, employerId: string, input: unknown) {
  const value = verificationSchema.parse(input);
  return transaction(async r => {
    await requireAdmin(r, actor);
    return recordEmployerVerificationDecision(r, employerId, actor.id, value.status, value.note);
  });
}

export const listAdminJobs = (actor: User, params: URLSearchParams) => listRows(actor, 'jobs', params);
export async function moderateAdminJob(actor: User, jobId: string, input: unknown) {
  const value = moderationSchema.parse(input);
  return transaction(async r => {
    await requireAdmin(r, actor);
    const job = await r.get<Job>('jobs', jobId);
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.');
    if (value.action === 'publish') {
      const employer = await r.get<{ status: string }>('employers', job.employerId);
      if (!employer || employer.status !== 'verified') throw new ApiError(409, 'VERIFICATION_REQUIRED', 'Verify the employer before publishing.');
      const risk = await persistJobFraudAssessment(r, job);
      if (risk.riskLevel === 'high' || risk.riskLevel === 'blocked') throw new ApiError(409, 'FRAUD_REVIEW_REQUIRED', 'Complete fraud review before publishing.');
    }
    const target = value.action === 'publish' ? 'active' : value.action === 'review' ? 'publishing' : value.action === 'close' ? 'closed' : 'removed';
    const transitioned = await transitionJobLifecycle(r, jobId, target, actor.id, `ADMIN_${value.action.toUpperCase()}`);
    const status: Job['status'] = value.action === 'publish' ? 'published' : value.action === 'review' ? 'review' : value.action === 'close' ? 'closed' : 'disabled';
    const next = { ...transitioned, status, ...(value.action === 'publish' ? { trust: 'verified' as const } : {}) };
    await r.put('jobs', next);
    await audit(r, actor.id, `admin.job_${value.action}`, jobId);
    return next;
  });
}

export const listAdminSources = (actor: User, params: URLSearchParams) => listRows(actor, 'jobSources', params);
export async function updateAdminSource(actor: User, sourceId: string, input: unknown) {
  await read(r => requireAdmin(r, actor));
  return updateJobSource(actor.id, sourceId, input);
}

export const listAdminFraud = (actor: User, params: URLSearchParams) => listRows(actor, 'fraudReports', params);
export async function reviewAdminFraud(actor: User, reportId: string, input: unknown) {
  const value = fraudReviewSchema.parse(input);
  return transaction(async r => {
    await requireAdmin(r, actor);
    const report = await r.get<Row>('fraudReports', reportId);
    if (!report) throw new ApiError(404, 'FRAUD_REPORT_NOT_FOUND', 'Fraud report not found.');
    if (report.status !== 'pending') throw new ApiError(409, 'FRAUD_REPORT_FINAL', 'This fraud report is already final.');
    const next = { ...report, status: value.status, reviewNote: value.note, reviewedBy: actor.id, reviewedAt: new Date().toISOString() };
    await r.put('fraudReports', next);
    await audit(r, actor.id, `admin.fraud_${value.status}`, reportId);
    return next;
  });
}

export const listAdminApplications = (actor: User, params: URLSearchParams) => listRows(actor, 'applications', params, (row: ApplicationRecord) => publicApplication(row));
export const listAdminPayments = (actor: User, params: URLSearchParams) => listRows(actor, 'payments', params, safePayment);
export const listAdminAudit = (actor: User, params: URLSearchParams) => listRows(actor, 'auditLogs', params, (row: AuditRecord) => ({ id: row.id, actorId: row.actorId, action: row.action, entityId: row.entityId, entityType: row.entityType, correlationId: row.correlationId, createdAt: row.createdAt ?? row.timestamp }));

export async function adminConfiguration(actor: User) {
  const allowed = ['plans', 'application-policy', 'fraud-policy', 'matching-ranking-policy', 'job-lifecycle-policy', 'job-discovery-policy', 'job-ingestion-policy'];
  return read(async r => {
    await requireAdmin(r, actor);
    const items = (await Promise.all(allowed.map(id => r.get<{ id: string; revision?: number }>('systemConfig', id))))
      .map((row, index) => ({ id: allowed[index], configured: !!row, revision: row?.revision ?? 0 }));
    return { items };
  });
}

export async function adminConsoleRoute(actor: User, parts: string[], method: string, params: URLSearchParams, body: () => Promise<unknown>) {
  if (parts[1] !== 'console') return null;
  const resource = parts[2], id = parts[3], action = parts[4];
  if (resource === 'overview' && method === 'GET') return adminOverview(actor);
  if (resource === 'users' && !id && method === 'GET') return listAdminUsers(actor, params);
  if (resource === 'users' && id && !action && method === 'GET') return adminUser(actor, id);
  if (resource === 'users' && id && action === 'state' && method === 'PUT') return setAdminUserState(actor, id, await body());
  if (resource === 'employers' && !id && method === 'GET') return listAdminEmployers(actor, params);
  if (resource === 'employers' && id && !action && method === 'GET') return adminEmployer(actor, id);
  if (resource === 'employers' && id && action === 'verification' && method === 'PUT') return verifyAdminEmployer(actor, id, await body());
  if (resource === 'jobs' && !id && method === 'GET') return listAdminJobs(actor, params);
  if (resource === 'jobs' && id && action === 'moderation' && method === 'POST') return moderateAdminJob(actor, id, await body());
  if (resource === 'sources' && !id && method === 'GET') return listAdminSources(actor, params);
  if (resource === 'sources' && id && method === 'PUT') return updateAdminSource(actor, id, await body());
  if (resource === 'fraud' && !id && method === 'GET') return listAdminFraud(actor, params);
  if (resource === 'fraud' && id && action === 'review' && method === 'POST') return reviewAdminFraud(actor, id, await body());
  if (resource === 'applications' && method === 'GET') return listAdminApplications(actor, params);
  if (resource === 'payments' && method === 'GET') return listAdminPayments(actor, params);
  if (resource === 'configuration' && method === 'GET') return adminConfiguration(actor);
  if (resource === 'audit' && method === 'GET') return listAdminAudit(actor, params);
  throw new ApiError(404, 'ADMIN_OPERATION_NOT_FOUND', 'The administrator operation was not found.');
}
