import { read, transaction } from './store.js';
import { isRecent, type Job } from './domain.js';

/** Keyset traversal visits all published jobs, even when earlier batches are closed. */
export async function expireJobs() {
  let cursor = '',
    expired = 0;
  for (;;) {
    const batch = await read((r) =>
      r.scan<Job>('jobs', { status: 'published' }, cursor),
    );
    if (!batch.length) return expired;
    expired += await transaction(async (r) => {
      let changed = 0;
      for (const item of batch) {
        const latest = await r.get<Job>('jobs', item.id);
        if (latest?.status === 'published' && !isRecent(latest)) {
          await r.put('jobs', { ...latest, status: 'closed' });
          changed++;
        }
      }
      return changed;
    });
    cursor = batch[batch.length - 1].id;
  }
}
