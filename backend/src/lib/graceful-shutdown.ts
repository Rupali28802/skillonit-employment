import type { Server } from 'node:http';

export async function closeHttpServer(server: Server, closeDependencies: () => Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeIdleConnections?.();
  // A disconnected client can leave a slow request open indefinitely. Give
  // active requests a short drain window, then close only their HTTP sockets;
  // dependency cleanup and persisted worker recovery still run normally.
  forceTimer = setTimeout(() => server.closeAllConnections?.(), Math.min(5000, Math.max(1000, Math.floor(timeoutMs / 3))));
  forceTimer.unref();
  try {
    await Promise.race([closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('GRACEFUL_SHUTDOWN_TIMEOUT')), timeoutMs); timer.unref(); })]);
    await closeDependencies();
  } catch (error) {
    server.closeAllConnections?.();
    try { await closeDependencies(); } catch { /* original failure is authoritative */ }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (forceTimer) clearTimeout(forceTimer);
  }
}
