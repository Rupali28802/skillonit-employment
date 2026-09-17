import { read, transaction } from './store.js';
import { isRecent, type Job } from './domain.js';

const DAY = 86400000;
export function expectedJobExpiry(job: Job) {
  const publishedAt = Date.parse(job.sourcePostedAt || job.discoveredAt);
  if (!Number.isFinite(publishedAt)) return job.expiresAt;
  const sourceClose = Date.parse(job.sourceExpiresAt || '');
  return new Date(Math.min(publishedAt + 90 * DAY, Number.isFinite(sourceClose) ? sourceClose : Infinity)).toISOString();
}

/** Keyset traversal visits all published jobs, even when earlier batches are closed. */
export async function expireJobs() {
  let cursor = '',
    expired = 0;
  for (;;) {
    const batch = await read((r) =>
      r.scan<Job>('jobs', { status: 'published' }, cursor),
    );
    if (!batch.length) return expired;
    // Most imported rows are fresh. Avoid one database round trip per live job.
    // Recheck candidates inside the transaction so a concurrent refresh is preserved.
    const candidates = batch.filter(item => item.feed && item.expiresAt !== expectedJobExpiry(item) || !isRecent(item));
    if (candidates.length) expired += await transaction(async (r) => {
      let changed = 0;
      const latestRows = await r.find<Job>('jobs', { id: { $in: candidates.map(item => item.id) } }, candidates.length);
      const writes: Job[] = [];
      for (const latest of latestRows) {
        if (!latest || latest.status !== 'published') continue;
        const repaired = latest.feed ? { ...latest, expiresAt: expectedJobExpiry(latest) } : latest;
        if (!isRecent(repaired)) {
          writes.push({ ...repaired, status: 'closed', ...(repaired.feed ? { feed: { ...repaired.feed, closedByEngine: true } } : {}) });
          changed++;
        } else if (repaired.expiresAt !== latest.expiresAt) writes.push(repaired);
      }
      await r.putMany('jobs', writes);
      return changed;
    });
    cursor = batch[batch.length - 1].id;
  }
}
