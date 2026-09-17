import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// No dotenv loader: the backend always uses this temporary replica set.
const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const { MongoMemoryReplSet } = requireBackend('mongodb-memory-server');
const sharp = requireBackend('sharp');
const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const origin = 'http://127.0.0.1:3100';
Object.assign(process.env, {
  MONGODB_URI: replica.getUri(), MONGODB_DATABASE: 'architecture_test',
  DEMO_MODE: 'true', HOST: '127.0.0.1', APP_URL: origin, NODE_ENV: 'test',
  ENABLE_AUTH_EMAIL: 'false', ENABLE_CV_UPLOADS: 'false',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_CALLBACK_URL: '',
});
const { app } = await import('../backend/src/app.js');
const { bootstrapIndexes, closeStore, transaction, read } = await import('../backend/src/lib/store.js');
const { sampleJobs } = await import('../backend/src/lib/fixtures.js');
let server: ReturnType<typeof app.listen> | undefined;
let next: ReturnType<typeof spawn> | undefined;
let requestCount = 0;
const nextEnv = { ...process.env, NODE_ENV: 'production', BACKEND_URL: 'http://127.0.0.1:3101', NEXT_DIST_DIR: '.next-integration', NEXT_TELEMETRY_DISABLED: '1' };
const frontend = fileURLToPath(new URL('../frontend/', import.meta.url));
const request = async (path: string, status = 200, cookie = '', method = 'GET', body?: unknown) => {
  const r = await fetch(origin + path, { method, redirect: 'manual',
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  assert.equal(r.status, status, `${method} ${path}: HTTP ${r.status}, expected ${status}`); requestCount++;
  return r;
};
const payload = async (path: string, cookie: string) => (await (await request(path, 200, cookie)).json()).data;
const cookieOf = (response: Response) => {
  const header = response.headers.get('set-cookie') || '';
  assert.ok(/HttpOnly/i.test(header) && /SameSite=Lax/i.test(header) && /Path=\//i.test(header), 'Application cookie attributes');
  return header.split(';')[0];
};
const expectLoginRedirect = async (cookie = '') => {
  const response = await fetch(origin + '/dashboard', { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
  requestCount++;
  if (response.status === 307) assert.equal(response.headers.get('location'), '/login');
  else {
    // A streamed App Router response carries its redirect in HTML after headers flush.
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(/<meta[^>]+http-equiv="refresh"[^>]+content="[^"\n]*url=\/login"/.test(html), 'Unauthenticated streamed page redirects to login');
    assert.ok(!html.includes('STUDENT WORKSPACE'), 'Protected workspace is not rendered anonymously');
  }
};
const command = async (args: string[], cwd: string, env: NodeJS.ProcessEnv, label: string) => {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', chunk => { output += String(chunk); });
  child.stderr?.on('data', chunk => { output += String(chunk); });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  // Only this controlled test/build output is emitted; private environment values are never printed.
  if (code !== 0) throw new Error(`${label} failed (exit ${code}). ${output.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[database address redacted]').slice(-5000)}`);
  console.log(`PASS: ${label}`);
};
try {
  await bootstrapIndexes();
  await transaction(async r => { for (const job of sampleJobs()) await r.put('jobs', job); });
  server = app.listen(3101, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server!.once('listening', resolve); server!.once('error', reject); });
  console.log('Building integrated frontend in .next-integration; current .next stays unchanged.');
  await command(['node_modules/next/dist/bin/next', 'build'], frontend, nextEnv, 'isolated frontend production build');
  next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3100'], {
    cwd: frontend, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: nextEnv,
  });
  next.stderr?.on('data', () => {});
  next.stdout?.on('data', () => {});
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (next.exitCode !== null) throw new Error('Test frontend exited before readiness.');
    try { ready = (await fetch(origin + '/api/v1/session', { signal: AbortSignal.timeout(1500) })).ok; } catch { /* Bounded startup wait. */ }
    if (ready) break;
    await delay(500);
  }
  assert.ok(ready, 'Test frontend started');
  const homepage = await (await request('/')).text();
  assert.ok(homepage.includes('Find the Right Job.') && homepage.includes('job-hero-art'), 'Existing homepage preserved');
  const styles = [...homepage.matchAll(/href="([^"\s]+\.css(?:\?[^"\s]*)?)"/g)].map(match => match[1]);
  const css = (await Promise.all(styles.map(async path => (await request(path.replaceAll('&amp;', '&'))).text()))).join('\n');
  for (const selector of ['.auth-card', '.profile-sidebar', '.job-hero', '.vertical-job-feed']) assert.ok(css.includes(selector), `Production CSS includes ${selector}`);
  const { upsertSource, runEngine } = await import('../backend/src/job-engine/engine.js');
  await upsertSource({ id: 'integration-feed', type: 'ashby', name: 'Fixture careers', board: 'fixture', company: 'Fixture Company',
    enabled: true, approved: true, publicListing: true, publish: true, intervalMinutes: 30, maxPages: 1,
    policyEvidence: 'Isolated integration fixture; no external provider requests.' });
  const fakeFeed = async () => ({ complete: true, snapshot: true, requests: 0, jobs: [{ externalId: 'nurse-1', title: 'Integration clinical nurse',
    company: 'Fixture Company', url: 'https://careers.example.com/nurse-1', description: 'A clinical role supporting patients and the nursing team.',
    location: 'Worldwide', postedAt: new Date().toISOString() }] });
  await runEngine(fakeFeed);
  const feedPage = await (await request('/')).text();
  assert.ok(feedPage.includes('Integration clinical nurse') && feedPage.includes('Salary not specified') && feedPage.includes('Experience not specified'));
  const feedJob = (await read(r => r.find<any>('jobs', { title: 'Integration clinical nurse' })))[0];
  const detail = await (await request('/jobs/' + feedJob.id)).text();
  assert.ok(detail.includes('View original job from') && detail.includes('https://careers.example.com/nurse-1'));
  await request('/api/v1/admin/job-engine', 401);
  const live = await fetch(origin + '/api/v1/jobs/stream', { signal: AbortSignal.timeout(20000) });
  const reader = live.body!.getReader();
  await reader.read();
  await delay(200);
  await transaction(async r => { const s = await r.get<any>('jobFeedStates', 'integration-feed'); await r.put('jobFeedStates', { ...s, nextRunAt: 0 }); });
  await runEngine(fakeFeed);
  let events = '';
  while (!events.includes('event: jobs')) { const chunk = await reader.read(); if (chunk.done) break; events += new TextDecoder().decode(chunk.value); }
  await reader.cancel(); assert.ok(events.includes('event: jobs'), 'Worker changes reach the frontend SSE proxy');
  for (const path of ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password']) await request(path);
  await expectLoginRedirect();
  await request('/api/v1/auth/google/callback', 400);
  const credentials = { email: `integration-${randomBytes(6).toString('hex')}@example.invalid`, password: randomBytes(24).toString('base64url') + 'aA1!', name: 'Integration Candidate', role: 'student' };
  const registered = await request('/api/v1/auth/register', 201, '', 'POST', credentials);
  const registrationCookie = cookieOf(registered);
  const registeredUser = (await payload('/api/v1/session', registrationCookie)).user;
  assert.equal(registeredUser.email, credentials.email);
  assert.equal(registeredUser.profile.experience, null);
  assert.equal(registeredUser.profile.country, '');
  const initialStatus = await payload('/api/v1/me/profile/status', registrationCookie);
  assert.ok(initialStatus.missingFields.includes('experience') && initialStatus.missingFields.includes('country'));
  assert.ok(await read(r => r.get('users', registeredUser.id)), 'Registration persisted in isolated MongoDB');
  await request('/api/v1/auth/register', 409, '', 'POST', credentials);
  await request('/api/v1/auth/login', 401, '', 'POST', { email: credentials.email, password: 'incorrect-password' });
  await request('/api/v1/auth/logout', 200, registrationCookie, 'POST');
  const login = await request('/api/v1/auth/login', 200, '', 'POST', { email: credentials.email, password: credentials.password });
  const cookie = cookieOf(login);
  const session = await payload('/api/v1/session', cookie);
  assert.equal(session.user.id, registeredUser.id);
  for (const path of ['/', '/dashboard', '/dashboard', '/profile', '/preferences', '/cvs', '/saved', '/applications']) await request(path, 200, cookie);
  const profile = await payload('/api/v1/me/profile', cookie);
  const status = await payload('/api/v1/me/profile/status', cookie);
  await request('/api/v1/me/profile', 200, cookie, 'PUT', { ...profile, experience: null, confirmed: false, expectedRevision: status.revision });
  await request('/api/v1/me/profile', 409, cookie, 'PUT', { ...profile, expectedRevision: status.revision });
  const preferences = await payload('/api/v1/me/preferences', cookie);
  const changed = (await (await request('/api/v1/me/preferences', 200, cookie, 'PUT', { roles: ['Software engineer'], expectedRevision: preferences.revision })).json()).data;
  const unchanged = (await (await request('/api/v1/me/preferences', 200, cookie, 'PUT', { roles: ['Software engineer'], expectedRevision: changed.revision })).json()).data;
  assert.equal(unchanged.revision, changed.revision, 'No-op preferences retain canonical revision');
  await request('/api/v1/me/preferences', 200, cookie, 'PUT', { roles: ['Backend engineer'], expectedRevision: unchanged.revision });
  const updated = await payload('/api/v1/me/preferences', cookie);
  assert.deepEqual(updated.roles, ['Backend engineer']);
  assert.deepEqual(updated.countries, preferences.countries);
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#16876a' } }).png().toBuffer();
  const upload = await fetch(origin + '/api/v1/me/profile-image/avatar', { method: 'PUT', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'image/png' }, body: image });
  assert.equal(upload.status, 200, 'Existing profile image backend works through proxy'); requestCount++;
  const version = (await upload.json()).data.version;
  const persisted = (await payload('/api/v1/session', cookie)).user;
  assert.equal(persisted.profile.avatarVersion, version);
  await request('/api/v1/me/profile', 200, cookie, 'PUT', { ...profile, headline: 'Integration profile', expectedRevision: persisted.profileRevision });
  assert.equal((await payload('/api/v1/session', cookie)).user.profile.avatarVersion, version, 'Profile save preserves existing photo');
  const avatar = await request('/api/v1/me/profile-image/avatar', 200, cookie);
  assert.equal(avatar.headers.get('content-type'), 'image/webp');
  await request('/api/v1/me/profile-image/avatar', 401);
  const other = cookieOf(await request('/api/v1/auth/demo', 200, '', 'POST', { role: 'student' }));
  await request('/api/v1/me/profile-image/avatar', 404, other);
  await request('/api/v1/me/cv', 200, cookie);
  await request('/api/v1/auth/logout', 200, cookie, 'POST');
  assert.equal((await payload('/api/v1/session', cookie)).user, null);
  await expectLoginRedirect(cookie);
  await command(['tests/architecture.mjs'], fileURLToPath(new URL('../backend/', import.meta.url)), { ...process.env, TEST_FRONTEND: origin, TEST_URL: 'http://127.0.0.1:3101', TEST_ORIGIN: origin }, 'all existing public/student/employer/admin route, proxy and authorization checks');
  console.log(`PASS: ${requestCount} frontend/Express requests plus architecture suite; live feed ingestion/SSE, truthful job details, password auth, session refresh/logout, profile/media preservation, revisions, preferences and compiled CSS. Live Google consent was not simulated.`);
  if (process.argv.includes('--keep-open')) {
    console.log(`Isolated integration preview: ${origin}. Temporary test data only; not the real Atlas database.`);
    await new Promise<void>(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally {
  if (next && next.exitCode === null) {
    const closed = new Promise<void>(resolve => next!.once('exit', () => resolve()));
    next.kill();
    await closed;
  }
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await closeStore();
  await replica.stop();
}
