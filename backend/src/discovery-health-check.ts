import { evaluateDiscoveryHealth, hasPublicJobsContract, minimumFastSources, type PublicDiscoveryStatus } from './job-engine/discovery-health.js';

const localHosts = new Set(['127.0.0.1', '::1', 'localhost']);

function endpointFrom(value: string | undefined, fallback: string, invalidCode: string) {
  try { return new URL(value || fallback); }
  catch { throw new Error(invalidCode); }
}

function assertPermittedEndpoint(endpoint: URL) {
  if (!localHosts.has(endpoint.hostname) && process.env.ALLOW_REMOTE_DISCOVERY_HEALTH !== 'true')
    throw new Error('DISCOVERY_HEALTH_URL_MUST_BE_LOOPBACK');
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('DISCOVERY_HEALTH_URL_PROTOCOL_INVALID');
}

async function checkPublicJobsEndpoint() {
  const configured = process.env.DISCOVERY_PUBLIC_JOBS_URL;
  if (!configured) return;
  const endpoint = endpointFrom(configured, '', 'DISCOVERY_PUBLIC_JOBS_URL_INVALID');
  assertPermittedEndpoint(endpoint);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`DISCOVERY_PUBLIC_JOBS_HTTP_${response.status}`);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error('DISCOVERY_PUBLIC_JOBS_CONTRACT_INVALID'); }
  if (!hasPublicJobsContract(payload)) throw new Error('DISCOVERY_PUBLIC_JOBS_CONTRACT_INVALID');
}

function publicJobsFailureCode(error: unknown) {
  return error instanceof Error && /^DISCOVERY_PUBLIC_JOBS_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'DISCOVERY_PUBLIC_JOBS_UNAVAILABLE';
}

try {
  const endpoint = endpointFrom(process.env.DISCOVERY_HEALTH_URL, 'http://127.0.0.1:4100/api/v1/jobs/discovery-status', 'DISCOVERY_HEALTH_URL_INVALID');
  assertPermittedEndpoint(endpoint);
  const fastSourceFloor = minimumFastSources();
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`DISCOVERY_HEALTH_HTTP_${response.status}`);
  const body = await response.json() as { data?: PublicDiscoveryStatus };
  const result = evaluateDiscoveryHealth(body.data || {}, Date.now(), fastSourceFloor);
  try {
    await checkPublicJobsEndpoint();
  } catch (error) {
    result.reasons.push(publicJobsFailureCode(error));
    result.healthy = false;
  }
  process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), ...result })}\n`);
  if (!result.healthy) process.exitCode = 1;
} catch (error) {
  const code = error instanceof Error && /^DISCOVERY_(?:HEALTH|PUBLIC_JOBS)_[A-Z0-9_]+$/.test(error.message) ? error.message : 'DISCOVERY_HEALTH_UNAVAILABLE';
  process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), healthy: false, reasons: [code] })}\n`);
  process.exitCode = 1;
}
