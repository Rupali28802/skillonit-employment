import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CvProviders } from '../src/lib/cv-providers.js';
import { validateCvProviders } from '../src/lib/cv-provider-validation.js';

// Contract doubles only. No credentials, network services or candidate documents.
function fixture() {
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  const providers: CvProviders & { check(): Promise<void> } = {
    async check() { calls.push('policy'); },
    storage: {
      async put(key, bytes) { calls.push('put'); objects.set(key, bytes); },
      async get(key) { calls.push('get'); return objects.get(key)!; },
      async delete(key) { calls.push('delete'); objects.delete(key); },
    },
    scanner: { async scan() { calls.push('scan'); return 'clean'; } },
    parser: { async extract() { calls.push('parse'); return {}; } },
  };
  return { providers, objects, calls };
}

test('Module 2 provider probe checks ordering, round-trip and cleanup (contract double)', async () => {
  const f = fixture(); const report = await validateCvProviders(f.providers);
  assert.ok(Object.values(report).every(value => value === 'PASS'));
  assert.deepEqual(f.calls, ['policy', 'put', 'get', 'scan', 'parse', 'delete']);
  assert.equal(f.objects.size, 0);
});
test('Module 2 provider probe refuses unsafe storage and stops parsing on scan failure', async () => {
  const unsafe = fixture(); unsafe.providers.check = async () => { throw new Error('private provider detail'); };
  assert.equal((await validateCvProviders(unsafe.providers)).storagePolicy, 'FAIL');
  assert.equal(unsafe.objects.size, 0); assert.ok(!unsafe.calls.includes('put'));
  const infected = fixture(); infected.providers.scanner.scan = async () => 'rejected';
  const report = await validateCvProviders(infected.providers);
  assert.equal(report.cleanDocumentScan, 'FAIL'); assert.equal(report.parserResponse, 'NOT_RUN');
  assert.equal(report.cleanupRequest, 'PASS'); assert.ok(!infected.calls.includes('parse')); assert.equal(infected.objects.size, 0);
});
test('Module 2 provider probe cleans partial writes and reports cleanup failure without private errors', async () => {
  const f = fixture(); const put = f.providers.storage.put;
  f.providers.storage.put = async (...args) => { await put(...args); throw new Error('private write detail'); };
  const report = await validateCvProviders(f.providers);
  assert.equal(report.storageRoundTrip, 'FAIL'); assert.equal(report.cleanupRequest, 'PASS'); assert.equal(f.objects.size, 0);
  const failed = fixture(); failed.providers.storage.delete = async () => { throw new Error('private cleanup detail'); };
  const outcome = await validateCvProviders(failed.providers);
  assert.equal(outcome.cleanupRequest, 'FAIL'); assert.ok(!JSON.stringify(outcome).includes('private'));
});
