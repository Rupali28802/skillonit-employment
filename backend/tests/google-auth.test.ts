import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { googleConfig, resolveGoogleUser } from '../src/google-auth.js';
import { transaction, read } from '../src/lib/store.js';
import { hashPassword, verifyPassword } from '../src/lib/security.js';
import { app } from '../src/app.js';

test('Google configuration fails closed without credentials or trusted callback', () => {
  assert.throws(() => googleConfig({}));
  assert.throws(() => googleConfig({ GOOGLE_CLIENT_ID: 'unit-test', GOOGLE_CLIENT_SECRET: 'unit-test', APP_URL: 'https://example.test', GOOGLE_CALLBACK_URL: 'https://other.test/api/v1/auth/google/callback' }));
});

test('local account-resolution unit checks (not a real Google identity validation)', async () => {
  const before = process.cwd(), env = { ...process.env };
  const dir = await mkdtemp(path.join(tmpdir(), 'skillonit-google-'));
  try {
    process.chdir(dir); delete process.env.MONGODB_URI;
    process.env.DEMO_MODE = 'true'; process.env.APP_URL = 'http://localhost:3000';
    const identity = { sub: 'unit-subject', email: 'google@example.test', name: 'Unit Google', emailVerified: true };
    await assert.rejects(resolveGoogleUser({ ...identity, emailVerified: false }));
    const created = await resolveGoogleUser(identity);
    assert.equal(created.authProvider, 'google'); assert.equal(created.passwordHash, null);
    assert.equal(created.verified, true); assert.equal(created.isVerified, true);
    assert.equal(verifyPassword('any password', created.passwordHash), false);
    assert.equal((await resolveGoogleUser(identity)).id, created.id);
    const local = { ...created, id: 'local-user', googleId: undefined, email: 'local@example.test', authProvider: 'password' as const, passwordHash: hashPassword('a-long-local-password'), verified: false };
    await transaction(r => r.put('users', local));
    const linkIdentity = { ...identity, sub: 'link-subject', email: local.email };
    await assert.rejects(resolveGoogleUser(linkIdentity), { code: 'GOOGLE_EMAIL_PROOF_REQUIRED' });
    const linked = await resolveGoogleUser(linkIdentity, local);
    assert.equal(linked.id, local.id); assert.equal(linked.passwordHash, local.passwordHash);
    assert.ok(verifyPassword('a-long-local-password', linked.passwordHash));
    assert.equal(await read(r => r.count('users', { email: local.email })), 1);
    await transaction(r => r.put('users', { ...linked, disabled: true }));
    await assert.rejects(resolveGoogleUser(linkIdentity));
    const gmail = { ...local, id: 'gmail-local', email: 'unit@gmail.com' };
    await transaction(r => r.put('users', gmail));
    const gmailIdentity = { ...identity, sub: 'gmail-subject', email: gmail.email };
    const associated = await resolveGoogleUser(gmailIdentity);
    assert.equal(associated.id, gmail.id);
    assert.equal(associated.passwordHash, gmail.passwordHash);
    assert.deepEqual(associated.profile, gmail.profile);
    assert.ok(verifyPassword('a-long-local-password', associated.passwordHash));
    assert.equal((await resolveGoogleUser(gmailIdentity)).id, gmail.id);
    assert.equal(await read(r => r.count('users', { email: gmail.email })), 1);
    await assert.rejects(resolveGoogleUser({ ...gmailIdentity, sub: 'conflicting-subject' }));
    const workspace = { ...local, id: 'workspace-local', email: 'unit@workspace.test' };
    await transaction(r => r.put('users', workspace));
    assert.equal((await resolveGoogleUser({ ...identity, sub: 'workspace-subject', email: workspace.email, hostedDomain: 'workspace.test' })).id, workspace.id);
  } finally {
    process.chdir(before); process.env = env;
    assert.equal(path.dirname(dir), path.resolve(tmpdir()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTP callbacks without valid browser-bound OAuth state are rejected', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening'); const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/v1/auth/google/callback`;
    assert.equal((await fetch(base)).status, 400);
    assert.equal((await fetch(base + '?code=invalid&state=' + 'a'.repeat(43))).status, 400);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
