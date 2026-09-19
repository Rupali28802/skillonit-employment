import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('job source API is admin-only, validated and revision safe', async () => {
  const cwd = process.cwd(), env = { ...process.env };
  const directory = await mkdtemp(path.join(tmpdir(), 'skillonit-source-api-'));
  process.chdir(directory); process.env.DEMO_MODE = 'true'; process.env.APP_URL = 'http://localhost:3000';
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
    let login = await request('auth/demo', 'POST', { role: 'student' });
    cookie = login.headers.getSetCookie().find(value => value.startsWith('skillonit_session='))!.split(';')[0];
    assert.equal((await request('admin/sources')).status, 403);
    login = await request('auth/demo', 'POST', { role: 'admin' });
    cookie = login.headers.getSetCookie().find(value => value.startsWith('skillonit_session='))!.split(';')[0];
    const create = await request('admin/sources', 'POST', {
      name: 'Controlled source', provider: 'greenhouse', configuration: { board: 'controlled' }, enabled: false,
      compliance: { status: 'pending', policyEvidence: 'Pending legal review before this source can be activated.', permittedMethod: 'official_api', jurisdictions: [] },
      schedule: { intervalMinutes: 60 }, rate: { requestsPerMinute: 2 },
      retry: { maxAttempts: 3, baseDelaySeconds: 30, maxDelaySeconds: 300 },
    });
    assert.equal(create.status, 201);
    const source = (await create.json()).data;
    assert.equal(source.health.status, 'disabled');
    assert.equal((await request('admin/sources/' + source.id, 'PATCH', { revision: source.revision, enabled: true })).status, 400);
    const update = await request('admin/sources/' + source.id, 'PATCH', {
      revision: source.revision, enabled: true,
      compliance: { status: 'approved', policyEvidence: 'Legal review approved use of the official public API integration.', permittedMethod: 'official_api', jurisdictions: ['global'] },
    });
    assert.equal(update.status, 200);
    const updated = (await update.json()).data;
    assert.equal(updated.enabled, true); assert.equal(updated.revision, 2);
    assert.equal((await request('admin/sources/' + source.id, 'PATCH', { revision: 1, name: 'stale' })).status, 409);
    const list = (await (await request('admin/sources')).json()).data;
    assert.equal(list.length, 1); assert.equal(list[0].configuration.board, 'controlled');
    assert.equal((await request(`admin/sources/${source.id}/events`)).status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    process.chdir(cwd); process.env = env;
    await rm(directory, { recursive: true, force: true });
  }
});
