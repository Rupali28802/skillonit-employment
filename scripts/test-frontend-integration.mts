import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Isolated MongoDB and dedicated test ports. Never loads either application's .env.
const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const { MongoMemoryReplSet } = requireBackend('mongodb-memory-server');
const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const origin = 'http://127.0.0.1:3100';
Object.assign(process.env, {
  MONGODB_URI: replica.getUri(), MONGODB_DATABASE: 'frontend_contract_test',
  DEMO_MODE: 'true', HOST: '127.0.0.1', APP_URL: origin, NODE_ENV: 'test',
  ENABLE_AUTH_EMAIL: 'false', ENABLE_CV_UPLOADS: 'false',
});
const { app } = await import('../backend/src/app.js');
const { bootstrapIndexes, closeStore } = await import('../backend/src/lib/store.js');
let server: ReturnType<typeof app.listen> | undefined;
let next: ReturnType<typeof spawn> | undefined;
let requestCount = 0;
const request = async (path: string, status = 200, cookie = '', method = 'GET', body?: unknown) => {
  const r = await fetch(origin + path, { method, redirect: 'manual',
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120000),
  });
  assert.equal(r.status, status, `${method} ${path}`); requestCount++;
  return r;
};
try {
  await bootstrapIndexes();
  server = app.listen(3101, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3100'], {
    cwd: fileURLToPath(new URL('../frontend/', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development', BACKEND_URL: 'http://127.0.0.1:3101', NEXT_TELEMETRY_DISABLED: '1' },
  });
  let failure = '';
  next.stderr?.on('data', chunk => { failure = String(chunk).slice(-1000); });
  next.stdout?.on('data', () => {});
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (next.exitCode !== null) throw new Error('Test frontend failed to start: ' + failure);
    try { ready = (await fetch(origin + '/api/v1/session', { signal: AbortSignal.timeout(1500) })).ok; } catch { /* Wait for startup. */ }
    if (ready) break;
    await delay(500);
  }
  assert.ok(ready, 'Test frontend started');
  const homepage = await (await request('/')).text();
  assert.ok(homepage.includes('Find the Right Job.') && homepage.includes('job-hero-art'));
  for (const path of ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password']) await request(path);
  await request('/api/v1/auth/login', 401, '', 'POST', { email: 'nobody@example.invalid', password: 'not-a-real-password' });
  const login = await request('/api/v1/auth/demo', 200, '', 'POST', { role: 'student' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const session = (await (await request('/api/v1/session', 200, cookie)).json()).data;
  assert.equal(session.user.role, 'student');
  for (const path of ['/', '/dashboard', '/profile', '/preferences', '/cvs', '/saved', '/applications']) await request(path, 200, cookie);
  const profile = (await (await request('/api/v1/me/profile', 200, cookie)).json()).data;
  const status = (await (await request('/api/v1/me/profile/status', 200, cookie)).json()).data;
  await request('/api/v1/me/profile', 200, cookie, 'PUT', { ...profile, experience: null, confirmed: false, expectedRevision: status.revision });
  await request('/api/v1/me/profile', 409, cookie, 'PUT', { ...profile, expectedRevision: status.revision });
  const preferences = (await (await request('/api/v1/me/preferences', 200, cookie)).json()).data;
  await request('/api/v1/me/preferences', 200, cookie, 'PUT', { roles: ['Software engineer'], expectedRevision: preferences.revision });
  const updated = (await (await request('/api/v1/me/preferences', 200, cookie)).json()).data;
  assert.deepEqual(updated.roles, ['Software engineer']);
  assert.deepEqual(updated.countries, preferences.countries);
  await request('/api/v1/me/cv', 200, cookie);
  await request('/api/v1/me/profile-image/avatar', 404, cookie);
  // Test Google's original PKCE/start contract without contacting Google or consenting.
  Object.assign(process.env, { DEMO_MODE: 'false', APP_URL: 'https://frontend.example', GOOGLE_CALLBACK_URL: 'https://frontend.example/api/v1/auth/google/callback', GOOGLE_CLIENT_ID: 'isolated-test-client', GOOGLE_CLIENT_SECRET: 'isolated-test-value' });
  const google = await request('/api/v1/auth/google', 302, cookie);
  const location = new URL(google.headers.get('location')!);
  assert.equal(location.hostname, 'accounts.google.com');
  assert.equal(location.searchParams.get('redirect_uri'), process.env.GOOGLE_CALLBACK_URL);
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.match(google.headers.get('set-cookie')!, /HttpOnly/);
  Object.assign(process.env, { DEMO_MODE: 'true', APP_URL: origin });
  await request('/api/v1/auth/logout', 200, cookie, 'POST');
  assert.equal((await (await request('/api/v1/session', 200, cookie)).json()).data.user, null);
  console.log(`PASS: ${requestCount} frontend/Express checks, preserved hero, authenticated pages, profile revision conflicts, preferences persistence, CV listing, original Google PKCE start and logout. Live Google consent was not simulated.`);
} finally {
  if (next?.pid) {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(next.pid), '/t', '/f'], { stdio: 'ignore' });
      await new Promise(resolve => killer.once('exit', resolve));
    } else next.kill('SIGTERM');
  }
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await closeStore();
  await replica.stop();
}
