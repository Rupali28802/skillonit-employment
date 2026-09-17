import type { Job, User } from './domain.js';
import { matchingInputs } from './job-matching.js';
import { read, transaction, type Repository } from './store.js';
import { ApiError, audit } from './security.js';
import { rankingPolicySchema, type RankingPolicy } from './matching-contracts.js';
import { candidateEmbeddingText, evaluateMatch, keywordScore, keywordTerms, loadMatchingCatalogs } from './matching-ranking.js';
import { configuredMatchingProviders, cosine, jobFingerprint, MatchingProviderError, type EmbeddingProvider, type MatchingSearchProvider } from './matching-providers.js';
import { z } from 'zod';

type PolicyRow = { id: string; revision: number; value: RankingPolicy };
export async function getRankingPolicy(r: Repository) {
  const row = await r.get<PolicyRow>('systemConfig', 'job-matching-policy');
  try { return { policy: rankingPolicySchema.parse(row?.value ?? {}), revision: row?.revision ?? 0 }; }
  catch { throw new ApiError(503, 'MATCHING_POLICY_INVALID', 'Matching configuration requires administrator review.'); }
}
export async function configureRankingPolicy(actor: User, input: unknown) {
  if (actor.disabled || actor.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
  const patch = z.object({ expectedRevision: z.number().int().min(0), policy: rankingPolicySchema }).strict().parse(input);
  return transaction(async r => {
    const latest = await r.get<User>('users', actor.id);
    if (!latest || latest.disabled || latest.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
    const row = await getRankingPolicy(r);
    if (row.revision !== patch.expectedRevision) throw new ApiError(409, 'MATCHING_POLICY_CONFLICT', 'Reload the ranking policy before saving.');
    await r.put('systemConfig', { id: 'job-matching-policy', revision: row.revision + 1, value: patch.policy });
    await audit(r, actor.id, 'matching.policy.updated', 'job-matching-policy');
    return { policy: patch.policy, revision: row.revision + 1 };
  });
}
export type EngineProviders = { search?: MatchingSearchProvider; embeddings?: EmbeddingProvider; candidateEmbeddingAllowed: boolean; semantic: boolean };
function runtimeProviders(): EngineProviders {
  const value = configuredMatchingProviders();
  return { search: value.search, embeddings: value.embeddings, candidateEmbeddingAllowed: value.config.candidateEmbeddingAllowed, semantic: value.config.semantic };
}
type MatchRow = { job: Job; match: ReturnType<typeof evaluateMatch> };
export async function runMatching(r: Repository, user: User, options: { q?: string; limit?: number; offset?: number } = {}, providers?: EngineProviders, now = Date.now()) {
  if (user.disabled || user.role !== 'student') throw new ApiError(403, 'FORBIDDEN', 'Student access required.');
  const { policy, revision } = await getRankingPolicy(r);
  const metadata = { policyVersion: policy.version, policyRevision: revision, profileRevision: user.profileRevision ?? 0,
    cvVersionId: user.activeCvVersionId ?? null, provider: 'local', semantic: 'OFF', degraded: [] as string[], scanned: 0, truncated: false,
    totalInCandidatePool: 0, nextOffset: null as number | null, pagination: 'bounded-candidate-pool' };
  if (!user.profile.confirmed) return { items: [] as MatchRow[], status: 'PROFILE_UNCONFIRMED', ...metadata };
  const consent = await r.get<{ granted: boolean }>('candidateConsents', user.id + ':profile');
  if (consent?.granted === false) return { items: [] as MatchRow[], status: 'PROFILE_CONSENT_REVOKED', ...metadata };
  const input = await matchingInputs(r, user), catalogs = await loadMatchingCatalogs(r);
  // New hierarchy-aware matcher receives original location IDs rather than flattening them to intersecting labels.
  input.preferences = { ...input.preferences, countries: user.preferences.countries, regions: user.preferences.regions,
    indiaStates: user.preferences.indiaStates, cities: user.preferences.cities };
  const terms = keywordTerms(input.profile, input.preferences, options.q);
  let runtime: EngineProviders = { semantic: false, candidateEmbeddingAllowed: false };
  try { runtime = providers ?? runtimeProviders(); }
  catch { metadata.degraded.push('PROVIDER_NOT_CONFIGURED'); if (!policy.allowKeywordFallback) throw new ApiError(503, 'MATCHING_UNAVAILABLE', 'Matching provider is unavailable.'); }
  let vector: number[] | undefined;
  if (runtime.semantic) {
    metadata.semantic = 'UNAVAILABLE';
    if (!runtime.candidateEmbeddingAllowed || consent?.granted !== true) metadata.semantic = 'CONSENT_REQUIRED';
    else if (runtime.embeddings) {
      const text = candidateEmbeddingText(input.profile);
      if (text) try { vector = await runtime.embeddings.embed(text); metadata.semantic = 'READY'; }
      catch { metadata.degraded.push('EMBEDDING_UNAVAILABLE'); }
    }
  }
  let candidates: { job: Job; semantic: number | null }[] | undefined;
  if (runtime.search) try {
    const hits = await runtime.search.retrieve(terms, vector, policy, now);
    if (hits.length > policy.candidatePool * 2) throw new MatchingProviderError('RETRIEVAL_LIMIT');
    metadata.provider = 'opensearch'; candidates = [];
    const seen = new Set<string>();
    for (const hit of hits) {
      if (seen.has(hit.id)) continue; seen.add(hit.id);
      const job = await r.get<Job>('jobs', hit.id); metadata.scanned++;
      if (!job) continue;
      let semantic: number | null = null;
      if (hit.fingerprint !== jobFingerprint(job)) metadata.degraded.push('STALE_INDEX_DOCUMENT');
      else if (vector && hit.vector && hit.vectorVersion === runtime.embeddings?.version) {
        try { semantic = cosine(vector, hit.vector); } catch { metadata.degraded.push('INVALID_JOB_VECTOR'); }
      }
      candidates.push({ job, semantic });
    }
    metadata.truncated = hits.length >= policy.candidatePool;
  } catch {
    if (!policy.allowKeywordFallback) throw new ApiError(503, 'MATCHING_UNAVAILABLE', 'Matching provider is unavailable.');
    candidates = undefined;
    metadata.scanned = 0;
    metadata.degraded.push('OPENSEARCH_UNAVAILABLE');
  }
  const rows: MatchRow[] = [];
  const consider = (job: Job, semantic: number | null) => {
    const match = evaluateMatch(job, user, input.profile, input.preferences, catalogs, policy, { keyword: keywordScore(job, terms), semantic }, now);
    if (match.status === 'SCORED' && match.score >= policy.minimumScore && match.score > 0) rows.push({ job, match });
  };
  if (candidates) candidates.forEach(row => consider(row.job, row.semantic));
  else {
    metadata.provider = 'local'; metadata.degraded.push('LOCAL_BOUNDED_RETRIEVAL');
    let after = '';
    while (metadata.scanned < policy.localScanLimit) {
      const size = Math.min(500, policy.localScanLimit - metadata.scanned);
      const page = await r.scan<Job>('jobs', { status: 'published', trust: 'verified' }, after, size);
      metadata.scanned += page.length;
      page.forEach(job => consider(job, null));
      if (page.length < size) break;
      const next = page.at(-1)!.id; if (next <= after) throw new ApiError(503, 'MATCHING_CURSOR', 'Matching retrieval could not continue.');
      after = next;
      if (metadata.scanned === policy.localScanLimit) metadata.truncated = (await r.scan<Job>('jobs', { status: 'published', trust: 'verified' }, after, 1)).length > 0;
    }
  }
  rows.sort((a, b) => b.match.score - a.match.score || Date.parse(b.job.discoveredAt) - Date.parse(a.job.discoveredAt) || a.job.id.localeCompare(b.job.id));
  const pool = rows.slice(0, policy.candidatePool);
  metadata.truncated ||= rows.length > pool.length;
  metadata.totalInCandidatePool = pool.length;
  const offset = options.offset ?? 0, limit = options.limit ?? 30;
  metadata.nextOffset = offset + limit < pool.length ? offset + limit : null;
  metadata.degraded = [...new Set(metadata.degraded)];
  if (!policy.allowKeywordFallback && runtime.semantic && metadata.degraded.includes('EMBEDDING_UNAVAILABLE')) throw new ApiError(503, 'MATCHING_UNAVAILABLE', 'Semantic matching is unavailable.');
  return { items: pool.slice(offset, offset + limit), status: metadata.degraded.length ? 'DEGRADED' : 'READY', ...metadata };
}
export async function getMatches(userId: string, options: { q?: string; limit?: number; offset?: number } = {}) {
  return read(async r => {
    const user = await r.get<User>('users', userId);
    if (!user || user.disabled) throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    return runMatching(r, user, options);
  });
}
