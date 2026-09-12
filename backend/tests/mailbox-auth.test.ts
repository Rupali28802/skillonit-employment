import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { app } from '../src/app.js';
import {
  decryptRefreshToken,
  encryptRefreshToken,
  mailboxConfig,
} from '../src/mailbox-auth.js';

function testConfig(change: Record<string, string> = {}) {
  return {
    MAIL_GOOGLE_CLIENT_ID: 'test-client',
    MAIL_GOOGLE_CLIENT_SECRET: 'test-secret',
    APP_URL: 'https://example.test',
    MAIL_GOOGLE_CALLBACK_URL:
      'https://example.test/api/v1/mail/google/callback',
    MAIL_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    ...change,
  };
}

test('mailbox configuration requires one trusted HTTPS callback origin', () => {
  assert.equal(
    mailboxConfig(testConfig()).MAIL_GOOGLE_CALLBACK_URL,
    'https://example.test/api/v1/mail/google/callback',
  );
  assert.throws(() =>
    mailboxConfig(testConfig({ APP_URL: 'http://example.test' })),
  );
  assert.throws(() =>
    mailboxConfig(
      testConfig({
        MAIL_GOOGLE_CALLBACK_URL:
          'https://other.test/api/v1/mail/google/callback',
      }),
    ),
  );
  assert.throws(() =>
    mailboxConfig(testConfig({ MAIL_TOKEN_ENCRYPTION_KEY: 'weak' })),
  );
});

test('mailbox refresh credentials are authenticated and encrypted at rest', () => {
  const key = randomBytes(32).toString('hex');
  const token = randomBytes(48).toString('base64url');
  const sealed = encryptRefreshToken(token, key);
  assert.equal(JSON.stringify(sealed).includes(token), false);
  assert.equal(decryptRefreshToken(sealed, key), token);
  assert.throws(() =>
    decryptRefreshToken(
      { ...sealed, tag: randomBytes(16).toString('base64url') },
      key,
    ),
  );
});

test('mailbox callback fails closed without browser-bound state', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, testConfig());
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/mail/google/callback`,
      { redirect: 'manual' },
    );
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get('location'),
      'https://example.test/mail?mail=error',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = previous;
  }
});
