import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('discovery operations and policy are restricted to admins', async () => {
  const cwd = process.cwd(), env = { ...process.env };
  const directory = await mkdtemp(path.join(tmpdir(), 'skillonit-discovery-api-'));
  process.chdir(directory); process.env.DEMO_MODE = 'true'; process.env.APP_URL = 'http://localhost:3000'; delete process.env.MONGODB_URI;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  let cookie = '';
  const request = (route: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${address.port}/api/v1/${route}`, {
    method, headers: { Origin: process.env.APP_URL!, Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    let login = await request('auth/demo', 'POST', { role: 'student' });
    cookie = login.headers.getSetCookie().find(value => value.startsWith('skillonit_session='))!.split(';')[0];
    assert.equal((await request('admin/discovery/status')).status, 403);
    assert.equal((await request('admin/discovery/config', 'PUT', {})).status, 403);
    login = await request('auth/demo', 'POST', { role: 'admin' });
    cookie = login.headers.getSetCookie().find(value => value.startsWith('skillonit_session='))!.split(';')[0];
    assert.equal((await request('admin/discovery/config', 'PUT', { enabled: true })).status, 400);
    const policy = { enabled: true, maxSourcesPerRun: 10, freshnessHours: 12, variantRetentionDays: 90, minimumHealthySources: 1 };
    assert.equal((await request('admin/discovery/config', 'PUT', policy)).status, 200);
    const status = await request('admin/discovery/status'); assert.equal(status.status, 200);
    assert.deepEqual((await status.json()).data.policy, policy);
    const run = await request('admin/discovery/run', 'POST', {}); assert.equal(run.status, 200);
    assert.equal((await run.json()).data.status, 'EMPTY');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); process.chdir(cwd); process.env = env;
    await rm(directory, { recursive: true, force: true });
  }
});
