import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Job, User } from './domain.js';
import type { Repository } from './store.js';
import { read, transaction } from './store.js';
import { ApiError, audit } from './security.js';
import { lifecycleState, transitionJobLifecycle } from './lifecycle.js';

export type FraudEntityType = 'job' | 'employer' | 'source' | 'destination';
export type FraudRiskLevel = 'low' | 'review' | 'high' | 'blocked';
export type FraudRiskState = 'clear' | 'pending_review' | 'flagged' | 'blocked';
export type FraudFinding = { code: string; score: number };
export type FraudAssessment = {
  id: string; entityType: FraudEntityType; entityId: string; rulesVersion: string;
  riskLevel: FraudRiskLevel; state: FraudRiskState; score: number;
  reasonCodes: string[]; automationAllowed: boolean; assessedAt: string;
};

export const fraudPolicySchema = z.object({
  rulesVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,60}$/).default('fraud-v1'),
  reviewThreshold: z.number().int().min(1).max(99).default(20),
  highThreshold: z.number().int().min(2).max(100).default(50),
  blockedThreshold: z.number().int().min(3).max(100).default(80),
  reportReviewCount: z.number().int().min(1).max(100).default(1),
  reportHighCount: z.number().int().min(2).max(100).default(3),
  freeEmailDomains: z.array(z.string().min(3).max(253)).max(100).default(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com']),
  shortenerDomains: z.array(z.string().min(3).max(253)).max(100).default(['bit.ly', 'tinyurl.com', 't.co']),
}).strict().superRefine((value, ctx) => {
  if (!(value.reviewThreshold < value.highThreshold && value.highThreshold < value.blockedThreshold))
    ctx.addIssue({ code: 'custom', path: ['reviewThreshold'], message: 'Risk thresholds must increase.' });
  if (value.reportReviewCount >= value.reportHighCount)
    ctx.addIssue({ code: 'custom', path: ['reportReviewCount'], message: 'Report thresholds must increase.' });
});
export type FraudPolicy = z.infer<typeof fraudPolicySchema>;
export const defaultFraudPolicy = () => fraudPolicySchema.parse({});

type Employer = { id: string; domain?: string; website?: string; status?: string };
type Source = { id: string; enabled?: boolean; approved?: boolean; compliance?: { status?: string }; health?: { status?: string; consecutiveFailures?: number } };
type Report = { entityType?: FraudEntityType; entityId: string; status: string };

const normalizeHost = (value: string) => value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
const relatedHosts = (left: string, right: string) => left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
const hostFromUrl = (value?: string) => {
  if (!value) return null;
  try { return normalizeHost(new URL(value).hostname); } catch { return null; }
};
const emailHost = (value?: string) => value?.split('@')[1] ? normalizeHost(value.split('@')[1]) : null;
const isIpHost = (host: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
const destinationId = (value: string) => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

async function policy(r: Repository) {
  const row = await r.get<{ value: unknown; revision: number }>('systemConfig', 'fraud-policy');
  try { return { value: fraudPolicySchema.parse(row?.value ?? {}), revision: row?.revision ?? 0 }; }
  catch { throw new ApiError(503, 'FRAUD_POLICY_INVALID', 'Fraud controls require administrator review.'); }
}

function result(entityType: FraudEntityType, entityId: string, findings: FraudFinding[], config: FraudPolicy, now: Date): FraudAssessment {
  const unique = [...new Map(findings.map(item => [item.code, item])).values()];
  const score = Math.min(100, unique.reduce((total, item) => total + item.score, 0));
  const riskLevel: FraudRiskLevel = score >= config.blockedThreshold ? 'blocked' : score >= config.highThreshold ? 'high' : score >= config.reviewThreshold ? 'review' : 'low';
  const state: FraudRiskState = riskLevel === 'blocked' ? 'blocked' : riskLevel === 'high' ? 'flagged' : riskLevel === 'review' ? 'pending_review' : 'clear';
  return { id: entityType === 'job' ? entityId : `${entityType}:${entityId}`, entityType, entityId, rulesVersion: config.rulesVersion, riskLevel, state, score, reasonCodes: unique.map(item => item.code).sort(), automationAllowed: riskLevel === 'low', assessedAt: now.toISOString() };
}

async function reportFindings(r: Repository, entityType: FraudEntityType, entityId: string, config: FraudPolicy) {
  const reports = (await r.find<Report>('fraudReports', { entityId }, 100)).filter(item => item.status === 'pending' && (!item.entityType || item.entityType === entityType));
  return reports.length >= config.reportHighCount ? [{ code: 'ABUSE_REPORT_THRESHOLD_HIGH', score: 55 }] : reports.length >= config.reportReviewCount ? [{ code: 'ABUSE_REPORT_PENDING', score: 25 }] : [];
}

function destinationFindings(job: Pick<Job, 'method' | 'url' | 'email' | 'domain'>, config: FraudPolicy): FraudFinding[] {
  const findings: FraudFinding[] = [], domain = normalizeHost(job.domain || '');
  if (job.method === 'email') {
    const host = emailHost(job.email);
    if (!host) findings.push({ code: 'DESTINATION_EMAIL_INVALID', score: 80 });
    else {
      if (domain && !relatedHosts(host, domain)) findings.push({ code: 'DESTINATION_DOMAIN_MISMATCH', score: 60 });
      if (config.freeEmailDomains.includes(host)) findings.push({ code: 'DESTINATION_FREE_EMAIL_PROVIDER', score: 25 });
    }
  }
  if (job.method === 'external') {
    let parsed: URL | null = null;
    try { parsed = job.url ? new URL(job.url) : null; } catch { /* finding below */ }
    if (!parsed) findings.push({ code: 'DESTINATION_URL_INVALID', score: 80 });
    else {
      const host = normalizeHost(parsed.hostname);
      if (parsed.protocol !== 'https:') findings.push({ code: 'DESTINATION_NOT_HTTPS', score: 60 });
      if (parsed.username || parsed.password) findings.push({ code: 'DESTINATION_URL_USERINFO', score: 80 });
      if (isIpHost(host)) findings.push({ code: 'DESTINATION_IP_HOST', score: 60 });
      if (host.includes('xn--')) findings.push({ code: 'DESTINATION_PUNYCODE_HOST', score: 45 });
      if (config.shortenerDomains.includes(host)) findings.push({ code: 'DESTINATION_SHORTENER', score: 50 });
      if (domain && !relatedHosts(host, domain)) findings.push({ code: 'DESTINATION_DOMAIN_MISMATCH', score: 25 });
      for (const key of ['redirect', 'redirect_uri', 'url', 'target', 'next']) {
        const nested = hostFromUrl(parsed.searchParams.get(key) || undefined);
        if (nested && !relatedHosts(nested, host)) findings.push({ code: 'DESTINATION_CROSS_DOMAIN_REDIRECT', score: 70 });
      }
    }
  }
  return findings;
}

export async function assessDestination(r: Repository, job: Pick<Job, 'method' | 'url' | 'email' | 'domain'>, now = new Date()) {
  const config = (await policy(r)).value;
  const raw = job.method === 'email' ? (job.email || '') : job.method === 'external' ? (job.url || '') : `direct:${job.domain}`;
  const entityId = destinationId(raw);
  return result('destination', entityId, [...destinationFindings(job, config), ...await reportFindings(r, 'destination', entityId, config)], config, now);
}

export async function assessEmployer(r: Repository, employer: Employer | null, now = new Date()) {
  const config = (await policy(r)).value, entityId = employer?.id || 'missing', findings: FraudFinding[] = [];
  if (!employer) findings.push({ code: 'EMPLOYER_MISSING', score: 25 });
  else {
    const domain = normalizeHost(employer.domain || ''), website = hostFromUrl(employer.website);
    if (employer.status === 'rejected') findings.push({ code: 'EMPLOYER_REJECTED', score: 80 });
    else if (employer.status !== 'verified') findings.push({ code: 'EMPLOYER_UNVERIFIED', score: 25 });
    if (!domain) findings.push({ code: 'EMPLOYER_DOMAIN_MISSING', score: 25 });
    if (website && domain && !relatedHosts(website, domain)) findings.push({ code: 'EMPLOYER_WEBSITE_DOMAIN_MISMATCH', score: 55 });
  }
  return result('employer', entityId, [...findings, ...await reportFindings(r, 'employer', entityId, config)], config, now);
}

export async function assessSource(r: Repository, source: Source | null, now = new Date()) {
  const config = (await policy(r)).value, entityId = source?.id || 'missing', findings: FraudFinding[] = [];
  if (!source) findings.push({ code: 'SOURCE_MISSING', score: 25 });
  else {
    if (!source.enabled) findings.push({ code: 'SOURCE_DISABLED', score: 25 });
    if (source.approved !== true && source.compliance?.status !== 'approved') findings.push({ code: 'SOURCE_UNAPPROVED', score: 80 });
    if (source.health?.status === 'failed') findings.push({ code: 'SOURCE_HEALTH_FAILED', score: 40 });
    else if (source.health?.status === 'degraded' || (source.health?.consecutiveFailures || 0) >= 3) findings.push({ code: 'SOURCE_HEALTH_DEGRADED', score: 25 });
  }
  return result('source', entityId, [...findings, ...await reportFindings(r, 'source', entityId, config)], config, now);
}

export async function assessJob(r: Repository, job: Job, now = new Date()) {
  const config = (await policy(r)).value, findings: FraudFinding[] = [];
  const text = `${job.title}\n${job.description}\n${job.requirements}`;
  if (/\b(registration|application|processing|security|training)\s+(fee|deposit)\b|\bpay\b.{0,30}\b(fee|deposit|recruiter)\b/i.test(text)) findings.push({ code: 'JOB_PAYMENT_REQUEST', score: 70 });
  if (/\b(send|share|provide|submit)\b.{0,35}\b(password|passcode|otp|one[- ]time password|pin|cvv)\b/i.test(text)) findings.push({ code: 'JOB_CREDENTIAL_HARVESTING', score: 80 });
  if (/\bguaranteed\s+(job|income|placement)\b|\bearn\b.{0,20}\b(per day|daily)\b.{0,20}\bwithout experience\b/i.test(text)) findings.push({ code: 'JOB_DECEPTIVE_CLAIM', score: 35 });
  // Repository operations share one PostgreSQL transaction client and must stay
  // sequential; concurrent client.query calls are unsupported by pg.
  const employer = job.employerId ? await r.get<Employer>('employers', job.employerId) : null;
  const legacySource = job.source ? await r.get<Source>('jobSources', job.source) : null;
  const feedSource = job.feed?.sourceId ? await r.get<Source>('jobFeedSources', job.feed.sourceId) : null;
  const feedState = job.feed?.sourceId ? await r.get<{ status?: string; failures?: number }>('jobFeedStates', job.feed.sourceId) : null;
  const source = legacySource || (feedSource ? { ...feedSource, health: { status: feedState?.status === 'failed' ? 'failed' : (feedState?.failures || 0) >= 3 ? 'degraded' : 'healthy', consecutiveFailures: feedState?.failures || 0 } } : null);
  const employerRisk = await assessEmployer(r, employer, now);
  const sourceRisk = await assessSource(r, source, now);
  const destinationRisk = await assessDestination(r, job, now);
  const reports = await reportFindings(r, 'job', job.id, config);
  if (employer || !source) {
    if (employerRisk.riskLevel === 'blocked' || employerRisk.riskLevel === 'high') findings.push({ code: 'EMPLOYER_RISK_HIGH', score: 55 });
    else if (employerRisk.riskLevel === 'review') findings.push({ code: 'EMPLOYER_REVIEW_REQUIRED', score: 20 });
  }
  if (source || !employer) {
    if (sourceRisk.riskLevel === 'blocked' || sourceRisk.riskLevel === 'high') findings.push({ code: 'SOURCE_RISK_HIGH', score: 55 });
    else if (sourceRisk.riskLevel === 'review') findings.push({ code: 'SOURCE_REVIEW_REQUIRED', score: 20 });
  }
  if (destinationRisk.riskLevel === 'blocked' || destinationRisk.riskLevel === 'high') findings.push({ code: 'DESTINATION_RISK_HIGH', score: 65 });
  else if (destinationRisk.riskLevel === 'review') findings.push({ code: 'DESTINATION_REVIEW_REQUIRED', score: 20 });
  return result('job', job.id, [...findings, ...reports], config, now);
}

export async function persistJobFraudAssessment(r: Repository, job: Job, now = new Date()) {
  const assessment = await assessJob(r, job, now);
  await r.put('jobRiskAssessments', assessment);
  const employer = job.employerId ? await r.get<Employer>('employers', job.employerId) : null;
  const source = job.source ? await r.get<Source>('jobSources', job.source) : null;
  const destination = await assessDestination(r, job, now);
  await r.put('entityRiskAssessments', await assessEmployer(r, employer, now));
  await r.put('entityRiskAssessments', await assessSource(r, source, now));
  await r.put('entityRiskAssessments', destination);
  return assessment;
}

export async function configureFraudPolicy(actor: User, input: unknown) {
  const data = z.object({ expectedRevision: z.number().int().min(0), policy: fraudPolicySchema }).strict().parse(input);
  return transaction(async r => {
    const current = await r.get<User>('users', actor.id), previous = await policy(r);
    if (!current || current.disabled || current.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
    if (previous.revision !== data.expectedRevision) throw new ApiError(409, 'FRAUD_POLICY_CONFLICT', 'Reload fraud policy before saving.');
    await r.put('systemConfig', { id: 'fraud-policy', revision: previous.revision + 1, value: data.policy });
    await audit(r, actor.id, 'fraud.policy_updated', 'fraud-policy');
    return { policy: data.policy, revision: previous.revision + 1 };
  });
}

export async function fraudOverview() {
  return read(async r => {
    const current = await policy(r);
    return { policy: current.value, revision: current.revision, jobs: await r.find('jobRiskAssessments', {}, 200), entities: await r.find('entityRiskAssessments', {}, 200), reports: await r.find('fraudReports', {}, 200) };
  });
}

export async function recheckFraud(actorId: string, input: unknown = {}) {
  const data = z.object({ jobId: z.string().max(100).optional(), limit: z.number().int().min(1).max(250).default(100) }).strict().parse(input);
  return transaction(async r => {
    const jobs = data.jobId ? [await r.get<Job>('jobs', data.jobId)].filter((item): item is Job => !!item) : await r.scan<Job>('jobs', {}, '', data.limit);
    if (data.jobId && !jobs.length) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.');
    let flagged = 0;
    for (const job of jobs) {
      const assessment = await persistJobFraudAssessment(r, job);
      if (assessment.riskLevel === 'high' || assessment.riskLevel === 'blocked') {
        flagged++;
        const transitioned = lifecycleState(job) === 'active' ? await transitionJobLifecycle(r, job.id, 'publishing', actorId, 'FRAUD_REVIEW_REQUIRED') : job;
        await r.put('jobs', { ...transitioned, trust: 'flagged', status: 'review' });
      }
    }
    await audit(r, actorId, 'fraud.rechecked', data.jobId || 'batch');
    return { assessed: jobs.length, flagged };
  });
}
