import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cvUploadsEnabled, demoEnabled, validateRuntime } from '../src/lib/runtime-config.js';

test('demo mode is local-only and production persistence is explicit', () => {
  const local = {
    DEMO_MODE: 'true',
    HOST: '127.0.0.1',
    APP_URL: 'http://localhost:3000',
  };
  assert.equal(demoEnabled(local), true);
  assert.doesNotThrow(() => validateRuntime(local));
  for (const change of [
    { NODE_ENV: 'production' },
    { HOST: '0.0.0.0' },
    { APP_URL: 'https://public.example.test' },
    { APP_URL: 'invalid' },
  ])
    assert.throws(() => demoEnabled({ ...local, ...change }));
  assert.throws(() => validateRuntime({ DEMO_MODE: 'false' }));
  assert.throws(() => validateRuntime({ DEMO_MODE: 'true', PORT: 'bad' }));
  assert.doesNotThrow(() =>
    validateRuntime({
      DEMO_MODE: 'false',
      MONGODB_URI: 'mongodb://placeholder',
      NODE_ENV: 'production',
    }),
  );
});

test('production requires an explicit CV upload mode but permits a fail-closed disabled mode', () => {
  assert.equal(cvUploadsEnabled({ NODE_ENV: 'production', ENABLE_CV_UPLOADS: 'false' }), false);
  assert.equal(cvUploadsEnabled({ NODE_ENV: 'production', ENABLE_CV_UPLOADS: 'true' }), true);
  assert.throws(() => cvUploadsEnabled({ NODE_ENV: 'production' }));
  assert.throws(() => cvUploadsEnabled({ NODE_ENV: 'production', ENABLE_CV_UPLOADS: 'enabled' }));
});

test('malformed MongoDB URI cannot expose credentials through diagnostics or startup', () => {
  const marker = randomBytes(16).toString('hex');
  for (const entry of ['src/db-check.ts', 'src/index.ts']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', entry], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        DEMO_MODE: 'false',
        MONGODB_URI: `invalid://${marker}:secret@example.test`,
      },
    });
    assert.equal(result.status, 1);
    assert.ok(!result.stdout.includes(marker));
    assert.ok(!result.stderr.includes(marker));
    assert.ok(!result.stderr.includes('invalid://'));
  }
});
