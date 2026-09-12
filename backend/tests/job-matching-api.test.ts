import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('matching HTTP API uses session owner, confirmed profile and persisted preferences', async () => {
  const cwd = process.cwd(), env = { ...process.env };
  const directory = await mkdtemp(path.join(tmpdir(), 'skillonit-matching-'));
  process.chdir(directory);
  process.env.DEMO_MODE = 'true'; process.env.APP_URL = 'http://localhost:3000';
  delete process.env.MONGODB_URI;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  let cookie = '';
  const request = (route: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${address.port}/api/v1/${route}`, {
    method, headers: { Origin: process.env.APP_URL!, Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    assert.equal((await request('me/matches')).status, 401);
    const login = await request('auth/demo', 'POST', { role: 'student' });
    assert.equal(login.status, 200);
    cookie = login.headers.getSetCookie().find(value => value.startsWith('skillonit_session='))!.split(';')[0];
    const profile = (await (await request('me/profile')).json()).data;
    assert.equal((await request('me/profile', 'PUT', { ...profile, confirmed: false })).status, 200);
    assert.deepEqual((await (await request('me/matches')).json()).data, []);
    assert.equal((await request('me/profile', 'PUT', { ...profile, confirmed: true })).status, 200);
    const response = await request('me/matches?userId=another-user');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const matches = (await response.json()).data;
    assert.ok(matches.length > 0);
    assert.ok(matches.every((row: any) => row.match.version === 'enterprise-matching-v2' && row.match.score <= 100 && !('email' in row)));
    const details = (await (await request('me/matches/details?limit=1')).json()).data;
    assert.equal(details.items.length, 1);
    assert.ok(details.items[0].match.explanations.length > 0);
    assert.equal(details.provider, 'local');
    assert.equal((await request('me/matches?limit=999')).status, 400);
    assert.equal((await request('admin/matching-policy')).status, 403);
    const dashboard = (await (await request('me/dashboard')).json()).data;
    assert.deepEqual(dashboard.matches.map((row: any) => row.job.id), matches.slice(0, 4).map((row: any) => row.id));
    assert.equal((await request('me/preferences', 'PUT', { modes: ['On-site'], countries: ['No matching country'] })).status, 200);
    assert.deepEqual((await (await request('me/matches')).json()).data, []);
    const employer = await request('auth/demo', 'POST', { role: 'employer' });
    cookie = employer.headers.getSetCookie().find(value => value.startsWith('skillonit_session='))!.split(';')[0];
    assert.equal((await request('me/matches')).status, 403);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    process.chdir(cwd); process.env = env;
    if (path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith('skillonit-matching-')) await rm(directory, { recursive: true, force: true });
  }
});
