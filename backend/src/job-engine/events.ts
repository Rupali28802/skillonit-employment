import { read } from '../lib/store.js';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let version: string | undefined, checking = false;
export function subscribeJobs(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const latest = await read(r => r.get<{ version: string }>('jobEngineState', 'feed-version'));
        if (latest?.version && version !== undefined && version !== latest.version) {
          for (const notify of listeners) notify();
        }
        version = latest?.version || '';
      } catch { /* A transient database outage must not terminate the SSE connection. */ }
      finally { checking = false; }
    };
    void check(); timer = setInterval(() => void check(), 5000); timer.unref();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) { clearInterval(timer); timer = undefined; version = undefined; }
  };
}
