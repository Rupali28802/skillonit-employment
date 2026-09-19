import { randomUUID } from 'node:crypto';
import type { User } from './domain.js';
import { providerHealth } from './providers.js';
import { ApiError } from './security.js';
import { read, transaction, type Repository } from './store.js';
export { safeLog } from './safe-logger.js';

type RequestMetric = { count: number; errors: number; totalDurationMs: number; maxDurationMs: number; latency: { le100: number; le500: number; le2000: number; over2000: number } };
const startedAt = Date.now();
const requests = new Map<string, RequestMetric>();

export function routeGroup(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'api' && parts[1] === 'v1' ? (parts[2] || 'root').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'other' : 'non-api';
}

export function recordHttpObservation(method: string, group: string, status: number, durationMs: number) {
  const safeMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method) ? method : 'OTHER';
  const safeGroup = group.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'other';
  const key = `${safeMethod}:${safeGroup}`;
  const current = requests.get(key) ?? { count: 0, errors: 0, totalDurationMs: 0, maxDurationMs: 0, latency: { le100: 0, le500: 0, le2000: 0, over2000: 0 } };
  current.count++; current.errors += status >= 400 ? 1 : 0; current.totalDurationMs += Math.max(0, durationMs); current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
  if (durationMs <= 100) current.latency.le100++; else if (durationMs <= 500) current.latency.le500++; else if (durationMs <= 2000) current.latency.le2000++; else current.latency.over2000++;
  requests.set(key, current);
}

export function processMetrics() {
  return {
    startedAt: new Date(startedAt).toISOString(), uptimeSeconds: Math.floor(process.uptime()), memoryRssMb: Math.round(process.memoryUsage().rss / 1048576),
    requests: Object.fromEntries([...requests.entries()].map(([key, value]) => [key, { ...value, averageDurationMs: value.count ? Math.round(value.totalDurationMs / value.count) : 0 }]))
  };
}

function label(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40); }
export function prometheusMetrics() {
  const metrics = processMetrics(), lines = [
    '# HELP skillonit_process_uptime_seconds Backend process uptime.', '# TYPE skillonit_process_uptime_seconds gauge', `skillonit_process_uptime_seconds ${metrics.uptimeSeconds}`,
    '# HELP skillonit_process_memory_rss_bytes Backend resident memory.', '# TYPE skillonit_process_memory_rss_bytes gauge', `skillonit_process_memory_rss_bytes ${process.memoryUsage().rss}`,
    '# HELP skillonit_http_requests_total HTTP requests by method, route group and outcome.', '# TYPE skillonit_http_requests_total counter',
    '# HELP skillonit_http_request_errors_total HTTP error responses.', '# TYPE skillonit_http_request_errors_total counter',
    '# HELP skillonit_http_request_duration_ms_sum Total observed request duration.', '# TYPE skillonit_http_request_duration_ms_sum counter',
  ];
  for (const [key, value] of Object.entries(metrics.requests)) {
    const [method, group] = key.split(':').map(label), labels = `{method="${method}",route_group="${group}"}`;
    lines.push(`skillonit_http_requests_total${labels} ${value.count}`, `skillonit_http_request_errors_total${labels} ${value.errors}`, `skillonit_http_request_duration_ms_sum${labels} ${value.totalDurationMs}`);
  }
  return lines.join('\n') + '\n';
}

export function resetProcessMetricsForTest() { requests.clear(); }

function retentionDays(env = process.env) {
  const value = Number(env.OBSERVABILITY_RETENTION_DAYS || 90);
  return Number.isInteger(value) && value >= 7 && value <= 395 ? value : 90;
}

export async function recordIncidentSignal(input: { correlationId: string; routeGroup: string; status: number; durationMs: number; classification?: string }, now = new Date()) {
  if (input.status < 429) return;
  const statusClass = `${Math.floor(input.status / 100)}xx`;
  await transaction(r => r.put('incidentSignals', {
    id: randomUUID(), schemaVersion: 1, correlationId: input.correlationId, routeGroup: input.routeGroup.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'other',
    status: input.status, statusClass, classification: ['rate_limit', 'dependency', 'authorization', 'request', 'conflict'].includes(input.classification || '') ? input.classification : statusClass,
    durationBucket: input.durationMs <= 100 ? 'le100' : input.durationMs <= 500 ? 'le500' : input.durationMs <= 2000 ? 'le2000' : 'over2000',
    createdAt: now.toISOString(), expiresAtDate: new Date(now.getTime() + retentionDays() * 86400000),
  }));
}

async function requireAdmin(r: Repository, actor: User) {
  const current = await r.get<User>('users', actor.id);
  if (!current || current.disabled || current.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
}

export async function observabilityOverview(actor: User, now = new Date()) {
  return read(async r => {
    await requireAdmin(r, actor);
    const since = new Date(now.getTime() - 15 * 60000).toISOString();
    const [processing, retries, deadLetters, recentSignals, sourceFailures, notificationFailures] = await Promise.all([
      r.find<Record<string, unknown>>('queueExecutions', { status: 'processing' }, 1000), r.count('queueExecutions', { status: 'retry_scheduled' }), r.count('deadLetterJobs', { status: 'pending' }),
      r.find<Record<string, unknown>>('incidentSignals', { createdAt: { $gte: since } }, 1000), r.count('jobIngestionEvents', { status: 'failed' }), r.count('notificationDeliveries', { status: 'failed' }),
    ]);
    const queueLagSeconds = processing.reduce((max, row) => Math.max(max, Math.max(0, Math.floor((now.getTime() - Date.parse(String(row.startedAt || row.updatedAt || now.toISOString()))) / 1000))), 0);
    const byStatusClass = Object.fromEntries(['4xx', '5xx'].map(status => [status, recentSignals.filter(row => row.statusClass === status).length]));
    const alerts = [
      ...(deadLetters ? [{ severity: 'critical', code: 'DEAD_LETTERS_PENDING', count: deadLetters }] : []),
      ...(queueLagSeconds > Number(process.env.OBSERVABILITY_QUEUE_LAG_ALERT_SECONDS || 300) ? [{ severity: 'warning', code: 'QUEUE_LAG_HIGH', value: queueLagSeconds }] : []),
      ...((byStatusClass['5xx'] || 0) >= Number(process.env.OBSERVABILITY_5XX_ALERT_COUNT || 5) ? [{ severity: 'critical', code: 'API_5XX_SPIKE', count: byStatusClass['5xx'] }] : []),
    ];
    return { generatedAt: now.toISOString(), process: processMetrics(), queue: { processing: processing.length, retries, deadLetters, lagSeconds: queueLagSeconds }, providers: providerHealth(), failures: { ingestion: sourceFailures, notifications: notificationFailures }, incidents: { windowMinutes: 15, byStatusClass }, alerts };
  });
}
