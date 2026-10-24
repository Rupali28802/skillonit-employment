import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDiscoveryHealth, hasPublicJobsContract } from '../src/job-engine/discovery-health.js';

const now = Date.parse('2026-10-08T06:00:00.000Z');

test('discovery health requires a fresh worker heartbeat and every fast source on cadence', () => {
  assert.deepEqual(evaluateDiscoveryHealth({
    workerOnline: true,
    workerLastSeenAt: new Date(now - 30_000).toISOString(),
    workerCycleStatus: 'completed',
    workerCycleCompletedAt: new Date(now - 30_000).toISOString(),
    tenMinuteSourcesConfigured: 22,
    tenMinuteSourcesOnCadence: 22,
  }, now), { healthy: true, reasons: [] });

  assert.deepEqual(evaluateDiscoveryHealth({
    workerOnline: true,
    workerLastSeenAt: new Date(now - 11 * 60_000).toISOString(),
    workerCycleStatus: 'failed',
    workerCycleCompletedAt: new Date(now - 11 * 60_000).toISOString(),
    tenMinuteSourcesConfigured: 22,
    tenMinuteSourcesOnCadence: 21,
  }, now), { healthy: false, reasons: ['WORKER_HEARTBEAT_STALE', 'WORKER_CYCLE_NOT_COMPLETED', 'WORKER_CYCLE_STALE', 'FAST_SOURCE_CADENCE_MISSED'] });
});

test('discovery health fails closed for missing status data or no configured fast source', () => {
  assert.deepEqual(evaluateDiscoveryHealth({}, now), {
    healthy: false,
    reasons: ['WORKER_OFFLINE', 'WORKER_HEARTBEAT_STALE', 'WORKER_CYCLE_NOT_COMPLETED', 'WORKER_CYCLE_STALE', 'FAST_SOURCE_CONFIG_INSUFFICIENT', 'FAST_SOURCE_CADENCE_MISSED'],
  });
});

test('public jobs probe accepts an empty catalogue but rejects an invalid envelope', () => {
  assert.equal(hasPublicJobsContract({ data: { jobs: [], total: 0 } }), true);
  assert.equal(hasPublicJobsContract({ data: { jobs: [{}], total: 1 } }), true);
  assert.equal(hasPublicJobsContract({ data: { jobs: [], total: -1 } }), false);
  assert.equal(hasPublicJobsContract({ data: { jobs: {}, total: 1 } }), false);
  assert.equal(hasPublicJobsContract({ data: { jobs: [], total: '1' } }), false);
  assert.equal(hasPublicJobsContract('<html>upstream failure</html>'), false);
});
