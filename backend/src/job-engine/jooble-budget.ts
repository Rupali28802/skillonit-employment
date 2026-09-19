import { transaction } from '../lib/store.js';

// No automatic reset: Jooble's free allowance is 500 requests for the lifetime of a key.
// Reserve ten for prior verification / provider-side usage outside this worker.
export const JOOBLE_REQUEST_LIMIT = 490;
export async function reserveJoobleRequest(country: string): Promise<boolean> {
  return transaction(async r => {
    const id = `jooble-budget-${country}`;
    const saved = await r.get<{ id: string; used: number }>('jobEngineState', id);
    const used = saved?.used ?? 0;
    if (!Number.isSafeInteger(used) || used < 0 || used >= JOOBLE_REQUEST_LIMIT) return false;
    // Reserve before the HTTP request, including failures and crashes. Restarts cannot refill it.
    await r.put('jobEngineState', { id, used: used + 1, limit: JOOBLE_REQUEST_LIMIT, updatedAt: new Date().toISOString() });
    return true;
  });
}
