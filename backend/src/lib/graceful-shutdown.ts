import type { Server } from 'node:http';

export async function closeHttpServer(server: Server, closeDependencies: () => Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeIdleConnections?.();
  try {
    await Promise.race([closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('GRACEFUL_SHUTDOWN_TIMEOUT')), timeoutMs); timer.unref(); })]);
    await closeDependencies();
  } catch (error) {
    server.closeAllConnections?.();
    try { await closeDependencies(); } catch { /* original failure is authoritative */ }
    throw error;
  } finally { if (timer) clearTimeout(timer); }
}
