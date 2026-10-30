export function demoEnabled(env = process.env) {
  if (env.DEMO_MODE !== 'true') return false;
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  let localOrigin = false;
  try {
    const origin = new URL(env.APP_URL || 'http://localhost:3000');
    localOrigin =
      loopback.has(origin.hostname) && !origin.username && !origin.password;
  } catch {
    /* Invalid configuration must fail closed. */
  }
  if (
    env.NODE_ENV === 'production' ||
    !loopback.has(env.HOST || '127.0.0.1') ||
    !localOrigin
  )
    throw new Error(
      'DEMO_MODE requires a local-only non-production backend and a loopback APP_URL.',
    );
  return true;
}

export function validateRuntime(env = process.env) {
  const demo = demoEnabled(env);
  if (!env.DATABASE_URL?.trim() && !env.MONGODB_URI?.trim() && !demo)
    throw new Error(
      'PostgreSQL or MongoDB configuration is required outside explicit local demo mode.',
    );
  if (env.DEMO_MODE && !['true', 'false'].includes(env.DEMO_MODE))
    throw new Error('DEMO_MODE must be true or false.');
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer from 1 to 65535.');
  const proxyHops = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 3)
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3.');
  for (const [name, fallback, min, max] of [['ABUSE_REQUESTS_PER_MINUTE', 300, 30, 5000], ['ABUSE_READS_PER_MINUTE', 240, 20, 5000], ['ABUSE_WEBHOOKS_PER_MINUTE', 600, 30, 10000]] as const) {
    const value = Number(env[name] || fallback); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  if (env.OBSERVABILITY_METRICS_TOKEN && env.OBSERVABILITY_METRICS_TOKEN.length < 32) throw new Error('OBSERVABILITY_METRICS_TOKEN must contain at least 32 characters.');
  for (const [name, fallback, min, max] of [['BACKUP_RPO_MINUTES', 60, 1, 1440], ['BACKUP_RTO_MINUTES', 240, 1, 10080], ['BACKUP_RETENTION_DAYS', 35, 7, 3650], ['RESTORE_DRILL_MAX_AGE_DAYS', 90, 1, 366], ['AUDIT_RETENTION_DAYS', 365, 90, 3650], ['OPERATIONAL_RETENTION_DAYS', 90, 7, 730], ['WEBHOOK_EVENT_RETENTION_DAYS', 90, 7, 730], ['RETENTION_BATCH_SIZE', 250, 10, 1000], ['SHUTDOWN_TIMEOUT_MS', 15000, 1000, 60000]] as const) {
    const value = Number(env[name] || fallback); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  if (env.BACKUP_ENABLED && !['true', 'false'].includes(env.BACKUP_ENABLED)) throw new Error('BACKUP_ENABLED must be true or false.');
}

/** CV processing is opt-in in production and must be explicitly configured. */
export function cvUploadsEnabled(env = process.env) {
  const value = env.ENABLE_CV_UPLOADS;
  if (env.NODE_ENV === 'production' && !['true', 'false'].includes(value || ''))
    throw new Error('ENABLE_CV_UPLOADS must be explicitly true or false');
  return value === 'true';
}

export type CvProcessingMode = 'queue' | 'direct';

/**
 * Queue mode is the normal production configuration. Direct mode is an
 * explicit, database-backed recovery path for CV processing when Redis is
 * unavailable; it still requires the dedicated worker and every CV provider.
 */
export function cvProcessingMode(env = process.env): CvProcessingMode {
  const value = env.CV_PROCESSING_MODE || 'queue';
  if (value === 'queue' || value === 'direct') return value;
  throw new Error('CV_PROCESSING_MODE must be queue or direct');
}

// Optional loopback preview alongside the configured HTTPS application.
// Never accepts arbitrary origins and never applies to a production backend.
export function isLocalPreviewOrigin(origin: string, env = process.env) {
  if (env.NODE_ENV === 'production' || env.HOST !== '127.0.0.1' || !env.LOCAL_PREVIEW_ORIGIN) return false;
  try {
    const local = new URL(env.LOCAL_PREVIEW_ORIGIN);
    return ['localhost', '127.0.0.1', '[::1]'].includes(local.hostname) && local.protocol === 'http:' && local.origin === origin && local.href === local.origin + '/';
  } catch { return false; }
}
