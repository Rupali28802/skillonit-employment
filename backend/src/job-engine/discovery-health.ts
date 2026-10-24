export type PublicDiscoveryStatus = {
  workerOnline?: unknown;
  workerLastSeenAt?: unknown;
  workerCycleStatus?: unknown;
  workerCycleCompletedAt?: unknown;
  tenMinuteSourcesConfigured?: unknown;
  tenMinuteSourcesOnCadence?: unknown;
  tenMinuteSourcesDegraded?: unknown;
};

export type DiscoveryHealth = { healthy: boolean; reasons: string[] };

/**
 * Minimal contract checked by the public-edge probe. An empty catalogue is
 * valid, but HTML fallbacks, malformed JSON, and changed API envelopes are
 * not. This avoids treating a successful discovery heartbeat as proof that
 * job seekers can actually load the feed.
 */
export function hasPublicJobsContract(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return false;
  const { jobs, total } = data as { jobs?: unknown; total?: unknown };
  return Array.isArray(jobs) && typeof total === 'number' && Number.isFinite(total) && total >= 0;
}

/**
 * The health probe must be told how many fast sources production expects.
 * Falling back to one preserves local development while an explicit deployment
 * value prevents a silently reduced source set from looking healthy.
 */
export function minimumFastSources(env = process.env) {
  const raw = env.DISCOVERY_MIN_FAST_SOURCES;
  if (raw === undefined || raw === '') return 1;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1000)
    throw new Error('DISCOVERY_HEALTH_MIN_FAST_SOURCES_INVALID');
  return value;
}

export function evaluateDiscoveryHealth(status: PublicDiscoveryStatus, now = Date.now(), minimumFastSources = 1): DiscoveryHealth {
  const reasons: string[] = [];
  if (status.workerOnline !== true) reasons.push('WORKER_OFFLINE');
  const lastSeen = typeof status.workerLastSeenAt === 'string' ? Date.parse(status.workerLastSeenAt) : NaN;
  if (!Number.isFinite(lastSeen) || now - lastSeen > 10 * 60_000 || lastSeen > now + 60_000) reasons.push('WORKER_HEARTBEAT_STALE');

  const completedAt = typeof status.workerCycleCompletedAt === 'string' ? Date.parse(status.workerCycleCompletedAt) : NaN;
  if (status.workerCycleStatus !== 'completed') reasons.push('WORKER_CYCLE_NOT_COMPLETED');
  if (!Number.isFinite(completedAt) || now - completedAt > 10 * 60_000 || completedAt > now + 60_000) reasons.push('WORKER_CYCLE_STALE');

  const configured = status.tenMinuteSourcesConfigured;
  const onCadence = status.tenMinuteSourcesOnCadence;
  if (!Number.isInteger(configured) || (configured as number) < minimumFastSources) reasons.push('FAST_SOURCE_CONFIG_INSUFFICIENT');
  if (!Number.isInteger(onCadence) || onCadence !== configured) reasons.push('FAST_SOURCE_CADENCE_MISSED');

  return { healthy: reasons.length === 0, reasons };
}
