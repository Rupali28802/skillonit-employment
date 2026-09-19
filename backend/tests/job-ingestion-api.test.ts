import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('ingestion controls are admin-only and strictly validated', async () => {
  const cwd = process.cwd(), env = { ...process.env }, directory = await mkdtemp(path.join(tmpdir(), 'skillonit-ingestion-api-'));
  process.chdir(directory); process.env.DEMO_MODE = 'true'; process.env.APP_URL = 'http://localhost:3000'; delete process.env.MONGODB_URI;
  const { app } = await import('../src/app.js'); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); let cookie = '';
  const request = (route: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${address.port}/api/v1/${route}`, { method, headers: { Origin: process.env.APP_URL!, Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    let login = await request('auth/demo', 'POST', { role: 'student' }); cookie = login.headers.getSetCookie().find(value => value.startsWith('skillonit_session='))!.split(';')[0];
    assert.equal((await request('admin/ingestion/status')).status, 403); assert.equal((await request('admin/ingestion/run', 'POST', {})).status, 403);
    login = await request('auth/demo', 'POST', { role: 'admin' }); cookie = login.headers.getSetCookie().find(value => value.startsWith('skillonit_session='))!.split(';')[0];
    assert.equal((await request('admin/ingestion/config', 'PUT', { enabled: true })).status, 400);
    const policy = { enabled: true, batchSize: 10, maxAttempts: 3, retryBaseMs: 1000, retentionDays: 90 };
    assert.equal((await request('admin/ingestion/config', 'PUT', policy)).status, 200);
    assert.equal((await request('admin/ingestion/status')).status, 200); assert.equal((await request('admin/ingestion/run', 'POST', {})).status, 200);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); process.chdir(cwd); process.env = env; await rm(directory, { recursive: true, force: true }); }
});
