import type { Repository } from './store.js';
import type { Job } from './domain.js';
import type { RankingPolicy } from './matching-contracts.js';
import { jobFingerprint, jobIndexText, type EmbeddingProvider, type MatchingSearchProvider } from './matching-providers.js';

type IndexState = { id: string; fingerprint: string; version: string };
/** Restart-safe ID upserts. Run one deployment scheduler; live MongoDB hydration remains authoritative. */
export async function syncMatchingIndex(r: Repository, search: MatchingSearchProvider, embeddings: EmbeddingProvider | undefined,
  policy: RankingPolicy, options: { after?: string; limit?: number; force?: boolean; version: string }, now = Date.now()) {
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));
  const jobs = await r.scan<Job>('jobs', {}, options.after ?? '', limit);
  let indexed = 0, removed = 0, skipped = 0;
  for (const job of jobs) {
    const live = job.status === 'published' && job.trust === 'verified' && Date.parse(job.expiresAt) > now &&
      Date.parse(job.discoveredAt) <= now && Date.parse(job.discoveredAt) >= now - policy.maxAgeDays * 86400000;
    if (!live) { await search.remove(job.id); await r.remove('matchingIndexState', job.id); removed++; continue; }
    const fingerprint = jobFingerprint(job), prior = await r.get<IndexState>('matchingIndexState', job.id);
    if (!options.force && prior?.fingerprint === fingerprint && prior.version === options.version) { skipped++; continue; }
    const vector = embeddings ? await embeddings.embed(jobIndexText(job)) : undefined;
    await search.index(job, vector);
    await r.put('matchingIndexState', { id: job.id, fingerprint, version: options.version }); indexed++;
  }
  return { indexed, removed, skipped, nextCursor: jobs.length === limit ? jobs.at(-1)!.id : null };
}
export async function removeDeletedIndexEntries(r: Repository, search: MatchingSearchProvider, after = '', limit = 100) {
  const size = Math.min(100, Math.max(1, limit));
  const states = await r.scan<IndexState>('matchingIndexState', {}, after, size);
  let removed = 0;
  for (const state of states) if (!(await r.get('jobs', state.id))) { await search.remove(state.id); await r.remove('matchingIndexState', state.id); removed++; }
  return { removed, nextCursor: states.length === size ? states.at(-1)!.id : null };
}
