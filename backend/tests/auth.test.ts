import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { app } from '../src/app.js';
import { read, transaction } from '../src/lib/store.js';
import { digest, rateLimit, verifyPassword } from '../src/lib/security.js';
import {
  issuePasswordReset,
  resetPassword,
} from '../src/lib/auth-lifecycle.js';
import type { User } from '../src/lib/domain.js';

test('auth lifecycle: reset, replay, ownership, expiry, sessions and production gating', async () => {
  const previous = process.cwd();
  const temp = await mkdtemp(path.join(tmpdir(), 'skillonit-auth-'));
  const savedEnv = { ...process.env };
  process.chdir(temp);
  delete process.env.MONGODB_URI;
  process.env.DEMO_MODE = 'true';
  process.env.APP_URL = 'http://localhost:3000';
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/v1/`;
    const password = randomBytes(24).toString('base64url');
    const replacement = randomBytes(24).toString('base64url');
    async function call(route: string, body?: object, cookie = '') {
      const response = await fetch(base + route, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          Cookie: cookie,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        json: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      };
    }
    const registration = await call('auth/register', {
      name: 'Auth Test',
      email: 'auth@example.test',
      password,
      role: 'student',
    });
    assert.equal(registration.status, 201);
    assert.equal(registration.json.data.user.passwordHash, undefined);
    const userId = registration.json.data.user.id;
    const other = await call('auth/register', {
      name: 'Other Test',
      email: 'other@example.test',
      password,
    });
    assert.equal(other.status, 201);
    const second = await call('auth/login', {
      email: 'auth@example.test',
      password,
    });
    assert.equal(second.status, 200);
    assert.equal(
      (
        await call('auth/register', {
          name: 'No Admin',
          email: 'admin@example.test',
          password,
          role: 'admin',
        })
      ).status,
      400,
    );
    const forgot = await call('auth/forgot-password', {
      email: 'auth@example.test',
    });
    assert.equal(forgot.status, 200);
    const token = forgot.json.data.demoResetToken;
    assert.ok(token);
    const storedReset = await read((r) =>
      r.get('passwordResets', digest(token)),
    );
    assert.ok(storedReset);
    assert.ok(!JSON.stringify(storedReset).includes(token));
    const missing = await call('auth/forgot-password', {
      email: 'missing@example.test',
    });
    assert.equal(missing.status, 200);
    assert.equal(missing.json.data.message, forgot.json.data.message);
    // Revocation must traverse beyond a single page, preserving another user's sessions.
    await transaction(async (r) => {
      for (let i = 0; i < 260; i++)
        await r.put('sessions', {
          id: `extra-${i.toString().padStart(3, '0')}`,
          userId,
        });
    });
    assert.equal(
      (await call('auth/reset-password', { token, password: 'short' })).status,
      400,
    );
    assert.equal(
      (await call('auth/reset-password', { token, password: replacement }))
        .status,
      200,
    );
    assert.equal(await read((r) => r.count('sessions', { userId })), 0);
    assert.equal(
      (await call('session', undefined, registration.cookie)).json.data.user,
      null,
    );
    assert.equal(
      (await call('session', undefined, second.cookie)).json.data.user,
      null,
    );
    assert.ok((await call('session', undefined, other.cookie)).json.data.user);
    assert.equal(
      (await call('auth/reset-password', { token, password: replacement }))
        .status,
      400,
    );
    assert.equal(
      (await call('auth/login', { email: 'auth@example.test', password }))
        .status,
      401,
    );
    const login = await call('auth/login', {
      email: 'auth@example.test',
      password: replacement,
    });
    assert.equal(login.status, 200);
    assert.equal((await call('auth/logout-all', {}, login.cookie)).status, 200);
    assert.equal(
      (await call('session', undefined, login.cookie)).json.data.user,
      null,
    );
    assert.equal((await call('auth/logout-all', {})).status, 401);
    assert.equal((await call('auth/demo', { role: 'student' })).status, 200);
    assert.equal((await call('auth/demo', { role: 'student' })).status, 200);
    const old = await issuePasswordReset('auth@example.test');
    const latest = await issuePasswordReset('auth@example.test');
    assert.ok(old && latest);
    await assert.rejects(resetPassword(old, replacement));
    await transaction(async (r) => {
      const row = await r.get<{ id: string }>('passwordResets', digest(latest));
      await r.put('passwordResets', { ...row!, expiresAt: Date.now() - 1 });
    });
    await assert.rejects(resetPassword(latest, replacement));
    const raceToken = await issuePasswordReset('auth@example.test');
    assert.ok(raceToken);
    const race = await Promise.allSettled([
      resetPassword(raceToken, password),
      resetPassword(raceToken, replacement),
    ]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    const user = await read((r) => r.get<User>('users', userId));
    assert.ok(
      user &&
        (verifyPassword(password, user.passwordHash) ||
          verifyPassword(replacement, user.passwordHash)),
    );
    await transaction((r) => r.put('users', { ...user!, disabled: true }));
    assert.equal(await issuePasswordReset('auth@example.test'), null);
    for (let i = 0; i < 5; i++) await rateLimit('isolated-account-test', 5);
    await assert.rejects(rateLimit('isolated-account-test', 5));
    const audits = await read((r) => r.find('auditLogs', { actorId: userId }));
    assert.ok(!JSON.stringify(audits).includes(password));
    assert.ok(!JSON.stringify(audits).includes(token));
    process.env.DEMO_MODE = 'false';
    // Production without MongoDB fails closed; no credential reset is fabricated.
    await assert.rejects(issuePasswordReset('auth@example.test'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(previous);
    process.env = savedEnv;
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(tmpdir()));
    assert.ok(path.basename(temp).startsWith('skillonit-auth-'));
    await rm(temp, { recursive: true, force: true });
  }
});
