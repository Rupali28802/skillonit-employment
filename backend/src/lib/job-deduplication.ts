import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Job, User } from './domain.js';
import type { Repository } from './store.js';
import { read, transaction } from './store.js';
import { ApiError, audit } from './security.js';
import { transitionJobLifecycle } from './lifecycle.js';

export const deduplicationPolicySchema = z.object({
  version: z.string().regex(/^[a-zA-Z0-9._-]{1,60}$/).default('job-dedupe-v1'),
  semanticEnabled: z.boolean().default(true),
  titleSimilarity: z.number().min(0.7).max(1).default(0.88),
  contentSimilarity: z.number().min(0.4).max(1).default(0.68),
  candidateLimit: z.number().int().min(10).max(500).default(200),
}).strict();
export type DeduplicationPolicy = z.infer<typeof deduplicationPolicySchema>;
export const defaultDeduplicationPolicy = () => deduplicationPolicySchema.parse({});

export type SourceReferenceInput = {
  variantId: string; sourceId: string; sourceJobId: string; fetchedAt: string;
  provenance: { provider: string; sourceUrl: string; permittedMethod: string };
};
export type DeduplicationOutcome = {
  kind: 'unique' | 'duplicate' | 'repost'; canonicalJobId: string; identityId: string;
  reasonCode: 'NEW_CANONICAL_IDENTITY' | 'EXACT_IDENTITY' | 'SEMANTIC_IDENTITY' | 'REPOST_AFTER_CLOSURE';
  repostOf?: string; sequence: number;
};
type CanonicalIdentity = {
  id: string; schemaVersion: number; policyVersion: string; activeJobId: string; jobIds: string[];
  occurrenceCount: number; createdAt: string; updatedAt: string;
};
type SourceReference = {
  id: string; schemaVersion: number; sourceId: string; sourceJobId: string; canonicalIdentityId: string;
  canonicalJobId: string; variantIds: string[]; firstSeenAt: string; lastSeenAt: string;
  provider: string; sourceUrl: string; permittedMethod: string;
  occurrences: { canonicalJobId: string; variantIds: string[]; firstSeenAt: string; lastSeenAt: string }[];
};

const normalized = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const tokens = (value: string) => new Set(normalized(value).split(' ').filter(token => token.length > 1));
const jaccard = (left: string, right: string) => {
  const a = tokens(left), b = tokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
};
const identityMaterial = (job: Job) => [job.domain || job.company, job.title, job.country, job.state, job.city, job.mode, job.type].map(normalized).join('|');
export const canonicalIdentityFingerprint = (job: Job) => digest(identityMaterial(job));
export const sourceReferenceFingerprint = (sourceId: string, sourceJobId: string) => digest(`${normalized(sourceId)}|${normalized(sourceJobId)}`);

async function policy(r: Repository) {
  const row = await r.get<{ value: unknown; revision: number }>('systemConfig', 'job-deduplication-policy');
  try { return { value: deduplicationPolicySchema.parse(row?.value ?? {}), revision: row?.revision ?? 0 }; }
  catch { throw new ApiError(503, 'DEDUPLICATION_POLICY_INVALID', 'Job deduplication configuration requires administrator review.'); }
}

function semanticallySame(candidate: Job, incoming: Job, config: DeduplicationPolicy) {
  if (!config.semanticEnabled || !candidate.domain || !incoming.domain || normalized(candidate.domain) !== normalized(incoming.domain)) return false;
  if ([candidate.country, candidate.state, candidate.city, candidate.mode, candidate.type].some((value, index) => normalized(value) !== normalized([incoming.country, incoming.state, incoming.city, incoming.mode, incoming.type][index]))) return false;
  const title = jaccard(candidate.title, incoming.title);
  const content = jaccard(`${candidate.description} ${candidate.requirements}`, `${incoming.description} ${incoming.requirements}`);
  return title >= config.titleSimilarity && content >= config.contentSimilarity;
}

const inactive = (job: Job, now: Date) => ['closed', 'disabled'].includes(job.status) || new Date(job.expiresAt) <= now;
const uniqueProvenance = (items: any[]) => [...new Map(items.map(item => [`${item.provider}|${item.sourceJobId}|${item.sourceUrl}|${item.fetchedAt}`, item])).values()];

async function writeReference(r: Repository, input: SourceReferenceInput, identityId: string, canonicalJobId: string) {
  const id = sourceReferenceFingerprint(input.sourceId, input.sourceJobId), current = await r.get<SourceReference>('jobSourceReferences', id);
  const priorOccurrences = current?.occurrences || (current ? [{ canonicalJobId: current.canonicalJobId, variantIds: current.variantIds, firstSeenAt: current.firstSeenAt, lastSeenAt: current.lastSeenAt }] : []);
  const occurrence = priorOccurrences.find(item => item.canonicalJobId === canonicalJobId);
  const occurrences = occurrence
    ? priorOccurrences.map(item => item.canonicalJobId === canonicalJobId ? { ...item, variantIds: [...new Set([...item.variantIds, input.variantId])], lastSeenAt: item.lastSeenAt > input.fetchedAt ? item.lastSeenAt : input.fetchedAt } : item)
    : [...priorOccurrences, { canonicalJobId, variantIds: [input.variantId], firstSeenAt: input.fetchedAt, lastSeenAt: input.fetchedAt }];
  const row: SourceReference = current ? {
    ...current, canonicalIdentityId: identityId, canonicalJobId,
    variantIds: [...new Set([...current.variantIds, input.variantId])], lastSeenAt: current.lastSeenAt > input.fetchedAt ? current.lastSeenAt : input.fetchedAt, occurrences,
    provider: input.provenance.provider, sourceUrl: input.provenance.sourceUrl, permittedMethod: input.provenance.permittedMethod,
  } : {
    id, schemaVersion: 1, sourceId: input.sourceId, sourceJobId: input.sourceJobId, canonicalIdentityId: identityId, canonicalJobId,
    variantIds: [input.variantId], firstSeenAt: input.fetchedAt, lastSeenAt: input.fetchedAt, occurrences, ...input.provenance,
  };
  await r.put('jobSourceReferences', row);
}

async function decision(r: Repository, input: SourceReferenceInput, outcome: DeduplicationOutcome, now: Date) {
  await r.put('jobDeduplicationDecisions', {
    id: input.variantId, schemaVersion: 1, variantId: input.variantId, sourceId: input.sourceId,
    canonicalIdentityId: outcome.identityId, canonicalJobId: outcome.canonicalJobId,
    kind: outcome.kind, reasonCode: outcome.reasonCode, sequence: outcome.sequence,
    ...(outcome.repostOf ? { repostOf: outcome.repostOf } : {}), createdAt: now.toISOString(),
  });
}

/** Must run inside the ingestion transaction so concurrent variants cannot create two canonical opportunities. */
export async function resolveCanonicalJob(r: Repository, incoming: Job & Record<string, unknown>, reference: SourceReferenceInput, now = new Date()): Promise<DeduplicationOutcome> {
  const config = (await policy(r)).value, exactId = canonicalIdentityFingerprint(incoming);
  let identity = await r.get<CanonicalIdentity>('canonicalJobIdentities', exactId), reason: DeduplicationOutcome['reasonCode'] = 'EXACT_IDENTITY';
  let matched: Job | null = identity ? await r.get<Job>('jobs', identity.activeJobId) : null;
  if (!matched && config.semanticEnabled && incoming.domain) {
    const candidates = await r.find<Job>('jobs', { domain: incoming.domain }, config.candidateLimit);
    matched = candidates.find(candidate => semanticallySame(candidate, incoming, config)) || null;
    if (matched) {
      const candidateIdentityId = (matched as any).canonicalIdentityId || canonicalIdentityFingerprint(matched);
      identity = await r.get<CanonicalIdentity>('canonicalJobIdentities', candidateIdentityId) || {
        id: candidateIdentityId, schemaVersion: 1, policyVersion: config.version, activeJobId: matched.id,
        jobIds: [matched.id], occurrenceCount: 1, createdAt: matched.discoveredAt, updatedAt: now.toISOString(),
      };
      reason = 'SEMANTIC_IDENTITY';
    }
  }
  if (identity && matched && !inactive(matched, now)) {
    const sourceVariantIds = [...new Set([...(matched as any).sourceVariantIds || [], reference.variantId])];
    const provenance = uniqueProvenance([...(matched as any).provenance || [], { ...reference.provenance, sourceJobId: reference.sourceJobId, fetchedAt: reference.fetchedAt }]);
    await r.put('jobs', { ...matched, sourceVariantIds, provenance, lastObservedAt: now.toISOString(), expiresAt: new Date(matched.expiresAt) > new Date(incoming.expiresAt) ? matched.expiresAt : incoming.expiresAt });
    await r.put('canonicalJobIdentities', { ...identity, updatedAt: now.toISOString() });
    await writeReference(r, reference, identity.id, matched.id);
    const outcome: DeduplicationOutcome = { kind: 'duplicate', canonicalJobId: matched.id, identityId: identity.id, reasonCode: reason, sequence: identity.occurrenceCount };
    await decision(r, reference, outcome, now);
    return outcome;
  }
  if (identity && matched) {
    const sequence = identity.occurrenceCount + 1;
    await transitionJobLifecycle(r, matched.id, 'reposted', 'job-ingestion-worker', 'REPOST_DISCOVERED', { now, relatedJobId: incoming.id });
    const repost = { ...incoming, canonicalIdentityId: identity.id, repostOf: matched.id, repostSequence: sequence, sourceVariantIds: [reference.variantId], provenance: uniqueProvenance([...(incoming as any).provenance || [], { ...reference.provenance, sourceJobId: reference.sourceJobId, fetchedAt: reference.fetchedAt }]) };
    await r.put('jobs', repost);
    await r.put('canonicalJobIdentities', { ...identity, activeJobId: incoming.id, jobIds: [...new Set([...identity.jobIds, incoming.id])], occurrenceCount: sequence, updatedAt: now.toISOString() });
    await writeReference(r, reference, identity.id, incoming.id);
    const outcome: DeduplicationOutcome = { kind: 'repost', canonicalJobId: incoming.id, identityId: identity.id, reasonCode: 'REPOST_AFTER_CLOSURE', repostOf: matched.id, sequence };
    await decision(r, reference, outcome, now);
    return outcome;
  }
  const identityId = exactId, first = { ...incoming, canonicalIdentityId: identityId, repostSequence: 1, sourceVariantIds: [reference.variantId], provenance: uniqueProvenance([...(incoming as any).provenance || [], { ...reference.provenance, sourceJobId: reference.sourceJobId, fetchedAt: reference.fetchedAt }]) };
  const row: CanonicalIdentity = { id: identityId, schemaVersion: 1, policyVersion: config.version, activeJobId: incoming.id, jobIds: [incoming.id], occurrenceCount: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  await r.put('jobs', first); await r.put('canonicalJobIdentities', row); await writeReference(r, reference, identityId, incoming.id);
  const outcome: DeduplicationOutcome = { kind: 'unique', canonicalJobId: incoming.id, identityId, reasonCode: 'NEW_CANONICAL_IDENTITY', sequence: 1 };
  await decision(r, reference, outcome, now);
  return outcome;
}

export async function configureDeduplicationPolicy(actor: User, input: unknown) {
  const data = z.object({ expectedRevision: z.number().int().min(0), policy: deduplicationPolicySchema }).strict().parse(input);
  return transaction(async r => {
    const current = await r.get<User>('users', actor.id), previous = await policy(r);
    if (!current || current.disabled || current.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
    if (previous.revision !== data.expectedRevision) throw new ApiError(409, 'DEDUPLICATION_POLICY_CONFLICT', 'Reload deduplication policy before saving.');
    await r.put('systemConfig', { id: 'job-deduplication-policy', revision: previous.revision + 1, value: data.policy });
    await audit(r, actor.id, 'deduplication.policy_updated', 'job-deduplication-policy');
    return { policy: data.policy, revision: previous.revision + 1 };
  });
}

export async function deduplicationOverview() {
  return read(async r => { const current = await policy(r); return { policy: current.value, revision: current.revision, identities: await r.count('canonicalJobIdentities'), sourceReferences: await r.count('jobSourceReferences'), recentDecisions: await r.find('jobDeduplicationDecisions', {}, 100) }; });
}
