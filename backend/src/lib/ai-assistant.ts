import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Job, User } from './domain.js';
import { isRecent, publicJob } from './domain.js';
import type { ApplicationRecord } from './application-engine.js';
import { applicationEligibility, publicApplication } from './application-engine.js';
import { searchJobs } from './search.js';
import { configuredPlans, read, transaction } from './store.js';
import { ApiError, audit, rateLimit } from './security.js';

export const assistantIntents = ['job_search', 'eligibility', 'qualifications', 'skills', 'deadline', 'selection_process', 'official_url', 'application_status', 'onboarding', 'employer_support'] as const;
export type AssistantIntent = typeof assistantIntents[number];
const requestSchema = z.object({ message: z.string().trim().min(1).max(500), jobId: z.string().min(1).max(100).optional(), applicationId: z.string().min(1).max(100).optional() }).strict();

export interface AssistantProvider { complete(input: { intent: AssistantIntent; facts: string[] }): Promise<string> }
export type AssistantProviderConfig = { provider: 'gemini'; endpoint: string; token: string; model: string; timeoutMs: number };

export function assistantProviderConfig(env = process.env): AssistantProviderConfig | null {
  if (!env.AI_ASSISTANT_PROVIDER || env.AI_ASSISTANT_PROVIDER === 'none') return null;
  const parsed = z.object({
    AI_ASSISTANT_PROVIDER: z.literal('gemini'), AI_ASSISTANT_URL: z.url(), AI_ASSISTANT_TOKEN: z.string().min(16),
    AI_ASSISTANT_MODEL: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/), AI_ASSISTANT_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(8000),
  }).safeParse(env);
  if (!parsed.success) throw new ApiError(503, 'ASSISTANT_PROVIDER_INVALID', 'The assistant provider configuration requires administrator review.');
  const url = new URL(parsed.data.AI_ASSISTANT_URL);
  const expectedPath = `/v1beta/models/${parsed.data.AI_ASSISTANT_MODEL}:generateContent`;
  if (url.protocol !== 'https:' || url.hostname !== 'generativelanguage.googleapis.com' || url.pathname !== expectedPath || url.search || url.hash || url.username || url.password)
    throw new ApiError(503, 'ASSISTANT_PROVIDER_INVALID', 'The assistant provider configuration requires administrator review.');
  return { provider: 'gemini', endpoint: url.href, token: parsed.data.AI_ASSISTANT_TOKEN, model: parsed.data.AI_ASSISTANT_MODEL, timeoutMs: parsed.data.AI_ASSISTANT_TIMEOUT_MS };
}

export class GeminiAssistantProvider implements AssistantProvider {
  constructor(private readonly config: AssistantProviderConfig) {}
  async complete(input: { intent: AssistantIntent; facts: string[] }) {
    const prompt = ['Rewrite the following verified SkillOnIT facts as a concise support answer.', 'Use only these facts. Do not infer eligibility, qualifications, dates, URLs, employers, or outcomes.', `Intent: ${input.intent}`, ...input.facts.map(fact => `Fact: ${fact}`)].join('\n');
    let response: Response;
    try { response = await fetch(this.config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.token }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 500 } }), signal: AbortSignal.timeout(this.config.timeoutMs) }); }
    catch { throw new ApiError(503, 'ASSISTANT_PROVIDER_UNAVAILABLE', 'The assistant provider is temporarily unavailable.'); }
    if (!response.ok) throw new ApiError(503, 'ASSISTANT_PROVIDER_UNAVAILABLE', 'The assistant provider is temporarily unavailable.');
    let payload: unknown; try { payload = await response.json(); } catch { throw new ApiError(503, 'ASSISTANT_PROVIDER_INVALID_RESPONSE', 'The assistant provider returned an invalid response.'); }
    const text = (payload as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new ApiError(503, 'ASSISTANT_PROVIDER_INVALID_RESPONSE', 'The assistant provider returned an invalid response.');
    return text.trim();
  }
}

function intent(message: string, input: { jobId?: string; applicationId?: string }, role: User['role']): AssistantIntent {
  const q = message.toLowerCase();
  if (input.applicationId || /application\s+(status|progress)|where.*application/.test(q)) return 'application_status';
  if (/eligib|can i apply|qualified/.test(q)) return 'eligibility';
  if (/qualification|requirement|education/.test(q)) return 'qualifications';
  if (/\bskills?\b/.test(q)) return 'skills';
  if (/deadline|closing|expire|last date/.test(q)) return 'deadline';
  if (/selection|interview|hiring process/.test(q)) return 'selection_process';
  if (/official (url|link)|apply link|website/.test(q)) return 'official_url';
  if (/onboard|profile|resume|\bcv\b/.test(q)) return 'onboarding';
  if (role === 'employer' && /job post|applicant|company|verification/.test(q)) return 'employer_support';
  return 'job_search';
}

function assistantConsentRequired(kind: AssistantIntent) { return ['eligibility', 'application_status'].includes(kind); }
function confirmedAssistantConsent(userId: string) { return read(async r => (await r.get<{ granted: boolean }>('candidateConsents', `${userId}:assistant`))?.granted === true); }

async function jobForUser(user: User, jobId?: string) {
  if (!jobId) throw new ApiError(400, 'JOB_REQUIRED', 'Select a job for this question.');
  const plans = await configuredPlans();
  return read(async r => {
    const job = await r.get<Job>('jobs', jobId);
    const canInspectPrivateJob = user.role === 'admin' || (user.role === 'employer' && job?.employerId === user.id);
    if (!job || (!isRecent(job) && !canInspectPrivateJob)) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found.');
    return { raw: job, safe: publicJob(job, user, plans) };
  });
}

function deterministic(kind: AssistantIntent, facts: string[]) {
  const lead: Record<AssistantIntent, string> = {
    job_search: 'Here are verified jobs matching your search.', eligibility: 'Application eligibility was checked using the current profile, job, consent, plan and quota rules.',
    qualifications: 'These are the qualifications currently published for this job.', skills: 'These are the skills currently published for this job.', deadline: 'This is the current stored application deadline.',
    selection_process: 'Selection process information is shown only when the employer or verified source supplied it.', official_url: 'The official application destination is shown only when your access and the verified job permit it.',
    application_status: 'This is the latest stored status for your application.', onboarding: 'Complete and confirm your profile, review any CV extraction, and set preferences before relying on personalized matching.',
    employer_support: 'Complete company verification before publishing jobs, then manage applicants through the employer workspace.',
  };
  return [lead[kind], ...facts].join(' ').trim();
}

export async function runAssistant(user: User, raw: unknown, provider?: AssistantProvider) {
  const input = requestSchema.parse(raw); await rateLimit(`assistant:${user.id}`, Math.min(60, Math.max(1, Number(process.env.AI_ASSISTANT_PER_MINUTE || 20) || 20)));
  const kind = intent(input.message, input, user.role);
  if (assistantConsentRequired(kind) && !(await confirmedAssistantConsent(user.id))) throw new ApiError(409, 'ASSISTANT_CONSENT_REQUIRED', 'Grant assistant data-processing consent before using personalized support.');
  let facts: string[] = [], jobs: unknown[] = [], sourceIds: string[] = [], officialUrl: string | undefined;
  if (kind === 'job_search') {
    const result = await searchJobs(new URLSearchParams({ q: input.message }), user); jobs = result.jobs.slice(0, 5); sourceIds = result.jobs.slice(0, 5).map(job => job.id); facts = result.total ? [`${result.total} verified opportunities matched the search.`] : ['No verified opportunity matched the search.'];
  } else if (kind === 'application_status') {
    if (!input.applicationId) throw new ApiError(400, 'APPLICATION_REQUIRED', 'Select an application for this question.');
    const application = await read(r => r.get<ApplicationRecord>('applications', input.applicationId!));
    if (!application || application.userId !== user.id) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Application not found.');
    const safe = publicApplication(application); facts = [`Status: ${safe.status}.`, `Job: ${safe.job.title}.`, `Last recorded event: ${safe.events.at(-1)?.status || safe.status}.`]; sourceIds = [application.id];
  } else if (kind === 'onboarding') facts = user.role === 'student' ? [`Profile confirmed: ${user.profile.confirmed ? 'yes' : 'no'}.`, `Confirmed CV selected: ${user.activeCvVersionId ? 'yes' : 'no'}.`] : ['Onboarding guidance is available for candidate accounts.'];
  else if (kind === 'employer_support') facts = ['Company verification is required before job publication.', 'Applicant records are limited to jobs owned by the authenticated employer.'];
  else {
    const job = await jobForUser(user, input.jobId); sourceIds = [job.raw.id];
    if (kind === 'eligibility') { if (user.role !== 'student') throw new ApiError(403, 'STUDENT_REQUIRED', 'Candidate eligibility requires a student account.'); const result = await applicationEligibility(user.id, { jobId: job.raw.id }); facts = [result.eligible ? 'Eligible under the current application rules.' : `Not currently eligible: ${result.reasons.join(', ')}.`, `Quota used: ${result.quota.used} of ${result.quota.cap}.`]; }
    if (kind === 'qualifications') facts = [job.safe.requirements || 'No qualifications were supplied.', ...(job.raw.matching?.requiredEducationLevels?.length ? [`Education: ${job.raw.matching.requiredEducationLevels.join(', ')}.`] : [])];
    if (kind === 'skills') facts = [(job.raw.matching?.requiredSkills?.length ? job.raw.matching.requiredSkills : job.safe.skills).length ? `Skills: ${(job.raw.matching?.requiredSkills?.length ? job.raw.matching.requiredSkills : job.safe.skills).join(', ')}.` : 'No structured skills were supplied.'];
    if (kind === 'deadline') facts = [`Deadline: ${job.safe.expiresAt}.`];
    if (kind === 'selection_process') { const value = (job.raw as Job & { selectionProcess?: unknown }).selectionProcess; facts = [typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : 'The verified source did not provide a selection process.']; }
    if (kind === 'official_url') { if (!job.safe.identityVisible || job.raw.method !== 'external' || !job.raw.url) facts = ['The official destination is not available for this account or application method.']; else { officialUrl = job.raw.url; facts = ['A verified official application destination is available.']; } }
  }
  const baseAnswer = deterministic(kind, facts), consent = await confirmedAssistantConsent(user.id);
  let answer = baseAnswer, mode: 'keyword-search' | 'grounded' | 'provider_grounded' = kind === 'job_search' ? 'keyword-search' : 'grounded', degraded: string[] = [];
  const runtimeProvider = provider ?? (() => { try { const config = assistantProviderConfig(); return config ? new GeminiAssistantProvider(config) : null; } catch { degraded.push('PROVIDER_NOT_CONFIGURED'); return null; } })();
  if (runtimeProvider && consent) try { answer = await runtimeProvider.complete({ intent: kind, facts }); mode = 'provider_grounded'; } catch { degraded.push('PROVIDER_UNAVAILABLE'); }
  const requestId = randomUUID();
  await transaction(async r => { await r.put('assistantInteractions', { id: requestId, userId: user.id, role: user.role, intent: kind, sourceIds, mode, degraded, createdAt: new Date().toISOString() }); await audit(r, user.id, 'assistant.requested', requestId); });
  return { requestId, intent: kind, mode, answer, jobs, ...(officialUrl ? { officialUrl } : {}), degraded };
}
