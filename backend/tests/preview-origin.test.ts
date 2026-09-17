import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalPreviewOrigin } from '../src/lib/runtime-config.js';

test('optional preview origin is exact, loopback-only and disabled in production', () => {
  const env = { HOST: '127.0.0.1', LOCAL_PREVIEW_ORIGIN: 'http://localhost:3000' };
  assert.equal(isLocalPreviewOrigin('http://localhost:3000', env), true);
  assert.equal(isLocalPreviewOrigin('http://localhost:3001', env), false);
  assert.equal(isLocalPreviewOrigin('https://evil.example', env), false);
  assert.equal(isLocalPreviewOrigin('http://localhost:3000', { ...env, NODE_ENV: 'production' }), false);
  assert.equal(isLocalPreviewOrigin('http://localhost:3000', { ...env, HOST: '0.0.0.0' }), false);
  assert.equal(isLocalPreviewOrigin('https://evil.example', { ...env, LOCAL_PREVIEW_ORIGIN: 'https://evil.example' }), false);
});
