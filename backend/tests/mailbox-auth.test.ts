import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { app } from '../src/app.js';
import {
  decryptRefreshToken,
  encryptRefreshToken,
  mailboxConfig,
  consumeMailboxConnectionVerification,
  storeMailboxConnectionVerification,
  verifyMailboxConnectionToken,
  recordMailboxConsent,
} from '../src/mailbox-auth.js';
import type { User } from '../src/lib/domain.js';
import type { Repository, Row } from '../src/lib/store.js';

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
  assert.equal(mailboxConfig(testConfig({ APP_URL: 'http://localhost:3100', MAIL_GOOGLE_CALLBACK_URL: 'http://localhost:3100/api/v1/mail/google/callback', NODE_ENV: 'development' })).APP_URL, 'http://localhost:3100');
  assert.throws(() => mailboxConfig(testConfig({ APP_URL: 'http://localhost:3100', MAIL_GOOGLE_CALLBACK_URL: 'http://localhost:3100/api/v1/mail/google/callback', NODE_ENV: 'production' })));
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

test('connecting and disconnecting Gmail records the corresponding mailbox permission', async () => {
  const rows = new Map<string, Map<string, Row>>();
  const bucket = (name: string) => { let value = rows.get(name); if (!value) { value = new Map(); rows.set(name, value); } return value; };
  const repository: Repository = {
    async putMany(name, values) { for (const value of values) bucket(name).set(value.id, value); },
    async page() { return []; }, async count() { return 0; }, async scan() { return []; }, async find() { return []; },
    async get<T>(name, id) { return (bucket(name).get(id) as T | undefined) ?? null; },
    async put(name, row) { bucket(name).set(row.id, row); }, async remove(name, id) { bucket(name).delete(id); },
  };
  const granted = await recordMailboxConsent(repository, 'candidate', true, '2026-01-01T00:00:00.000Z');
  assert.equal(granted.status, 'granted');
  const revoked = await recordMailboxConsent(repository, 'candidate', false, '2026-01-02T00:00:00.000Z');
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.grantedAt, granted.grantedAt);
  assert.equal(bucket('candidateConsentEvents').size, 2);
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
      'https://example.test/profile?mail=error',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = previous;
  }
});

test('mailbox callback reports a cancelled Google consent without claiming success', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, testConfig());
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/mail/google/callback?error=access_denied`,
      { redirect: 'manual' },
    );
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get('location'),
      'https://example.test/profile?mail=cancelled',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = previous;
  }
});

test('email-first mailbox proof is hashed, session-bound, expiring and single-use', async () => {
  const user: User = {
    id: 'mail-user', name: 'Mail Candidate', email: 'candidate@example.test', role: 'student',
    plan: 'free', passwordHash: 'password-hash-fixture', verified: true,
    createdAt: new Date().toISOString(), profile: {}, preferences: { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 0 },
  };
  const collections = new Map<string, Map<string, Row>>();
  const bucket = (name: string) => { let value = collections.get(name); if (!value) { value = new Map(); collections.set(name, value); } return value; };
  const repository: Repository = {
    async putMany(name, rows) { for (const row of rows) bucket(name).set(row.id, row); },
    async page() { return []; }, async count() { return 0; }, async scan() { return []; },
    async find<T>(name, query = {}) { return [...bucket(name).values()].filter(row => Object.entries(query).every(([key, value]) => row[key] === value)) as T[]; },
    async get<T>(name, id) { return (bucket(name).get(id) as T | undefined) ?? null; },
    async put(name, row) { bucket(name).set(row.id, row); }, async remove(name, id) { bucket(name).delete(id); },
  };
  const token = randomBytes(32).toString('base64url');
  await storeMailboxConnectionVerification(repository, user, token, new Date(Date.now() + 60_000));
  assert.equal(JSON.stringify([...collections.values()].flatMap(value => [...value.values()])).includes(token), false);
  await consumeMailboxConnectionVerification(repository, user, token);
  assert.ok(await repository.get('mailConnectionProofs', user.id));
  await assert.rejects(consumeMailboxConnectionVerification(repository, user, token), /invalid or expired/i);
  await assert.rejects(consumeMailboxConnectionVerification(repository, { ...user, id: 'forwarded-user' }, token), /invalid or expired/i);
});

test('email-first mailbox proof rejects expired, malformed and wrong-account tokens', async () => {
  const user: User = {
    id: 'mail-user-security', name: 'Mail Candidate', email: 'candidate@example.test', role: 'student',
    plan: 'free', passwordHash: 'password-hash-fixture', verified: true,
    createdAt: new Date().toISOString(), profile: {}, preferences: { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 0 },
  };
  const collections = new Map<string, Map<string, Row>>();
  const bucket = (name: string) => { let value = collections.get(name); if (!value) { value = new Map(); collections.set(name, value); } return value; };
  const repository: Repository = {
    async putMany(name, rows) { for (const row of rows) bucket(name).set(row.id, row); },
    async page() { return []; }, async count() { return 0; }, async scan() { return []; },
    async find<T>(name, query = {}) { return [...bucket(name).values()].filter(row => Object.entries(query).every(([key, value]) => row[key] === value)) as T[]; },
    async get<T>(name, id) { return (bucket(name).get(id) as T | undefined) ?? null; },
    async put(name, row) { bucket(name).set(row.id, row); }, async remove(name, id) { bucket(name).delete(id); },
  };
  await assert.rejects(verifyMailboxConnectionToken(user, 'not-a-valid-token'), /invalid or expired/i);
  const expired = randomBytes(32).toString('base64url');
  await storeMailboxConnectionVerification(repository, user, expired, new Date(Date.now() - 1));
  await assert.rejects(consumeMailboxConnectionVerification(repository, user, expired), /invalid or expired/i);

  const owned = randomBytes(32).toString('base64url');
  await storeMailboxConnectionVerification(repository, user, owned, new Date(Date.now() + 60_000));
  await assert.rejects(
    consumeMailboxConnectionVerification(repository, { ...user, id: 'different-user' }, owned),
    /invalid or expired/i,
  );
  assert.equal(await repository.get('mailConnectionProofs', user.id), null);
});
