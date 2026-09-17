import { read, transaction, closeStore } from './lib/store.js';
import { configuredMatchingProviders } from './lib/matching-providers.js';
import { getRankingPolicy } from './lib/matching-engine.js';
import { removeDeletedIndexEntries, syncMatchingIndex } from './lib/matching-indexer.js';
import { randomUUID } from 'node:crypto';

const owner = randomUUID();
let ownsLease = false;
try {
  if (process.env.DEMO_MODE !== 'false' || !process.env.MONGODB_URI) throw new Error();
  const providers = configuredMatchingProviders();
  if (!providers.search) throw new Error();
  const acquired = await transaction(async r => {
    const lease = await r.get<{ owner: string; until: number }>('systemConfig', 'matching-index-lease');
    if (lease && lease.until > Date.now()) return false;
    await r.put('systemConfig', { id: 'matching-index-lease', owner, until: Date.now() + 600000 }); return true;
  });
  if (!acquired) throw new Error();
  ownsLease = true;
  await providers.search.ensureIndex();
  const { policy } = await read(getRankingPolicy);
  const version = `${providers.key}:${providers.embeddings?.version ?? 'keyword-v1'}`;
  let after = '', pages = 0;
  for (;;) {
    // One job per batch bounds lease time even with provider retries; release/replay on failure.
    await transaction(async r => {
      const lease = await r.get<{ owner: string }>('systemConfig', 'matching-index-lease');
      if (lease?.owner !== owner) throw new Error();
      await r.put('systemConfig', { id: 'matching-index-lease', owner, until: Date.now() + 600000 });
    });
    const result = await read(r => syncMatchingIndex(r, providers.search!, providers.embeddings, policy, { after, limit: 1, force: process.argv.includes('--force'), version }));
    pages++; if (!result.nextCursor) break; after = result.nextCursor;
  }
  let cursor = '';
  for (;;) {
    await transaction(async r => {
      const lease = await r.get<{ owner: string }>('systemConfig', 'matching-index-lease');
      if (lease?.owner !== owner) throw new Error();
      await r.put('systemConfig', { id: 'matching-index-lease', owner, until: Date.now() + 600000 });
    });
    const result = await read(r => removeDeletedIndexEntries(r, providers.search!, cursor, 1));
    if (!result.nextCursor) break; cursor = result.nextCursor;
  }
  console.log(JSON.stringify({ matchingIndex: 'PASS', batches: pages }));
} catch { console.error('MATCHING_INDEX_FAILED: check provider configuration, availability, mappings and worker lease.'); process.exitCode = 1; }
finally {
  if (ownsLease) await transaction(async r => { const lease = await r.get<{ owner: string }>('systemConfig', 'matching-index-lease'); if (lease?.owner === owner) await r.remove('systemConfig', 'matching-index-lease'); }).catch(() => {});
  await closeStore();
}
