import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

test('profile images validate, persist, stay private, and survive profile edits', async () => {
  const original = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), 'skillonit-profile-test-'));
  process.chdir(directory);
  process.env.DEMO_MODE = 'true';
  process.env.APP_URL = 'http://localhost:3000';
  delete process.env.MONGODB_URI;
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/v1/`;
  let cookie = '';
  async function request(route: string, method = 'GET', body?: Uint8Array | string, contentType = 'application/json') {
    return fetch(base + route, { method, headers: { Origin: 'http://localhost:3000', Cookie: cookie, 'Content-Type': contentType }, body: body as BodyInit | undefined });
  }
  try {
    assert.equal((await request('me/profile-image/avatar')).status, 401);
    const login = await request('auth/demo', 'POST', JSON.stringify({ role: 'student' }));
    cookie = login.headers.get('set-cookie')!.split(';')[0];
    const png = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#207861' } }).png().toBuffer();
    for (const kind of ['avatar', 'cover', 'logo']) {
      assert.equal((await request(`me/profile-image/${kind}`, 'PUT', png, 'image/png')).status, 200);
      const saved = await request(`me/profile-image/${kind}`);
      assert.equal(saved.headers.get('content-type'), 'image/webp');
      const metadata = await sharp(Buffer.from(await saved.arrayBuffer())).metadata();
      assert.equal(metadata.width, kind === 'cover' ? 1000 : 320);
    }
    assert.equal((await request('me/profile-image/avatar', 'PUT', '<svg/>', 'image/svg+xml')).status, 415);
    assert.equal((await request('me/profile-image/avatar', 'PUT', 'invalid', 'image/png')).status, 400);
    assert.equal((await request('me/profile-image/avatar', 'PUT', new Uint8Array(2 * 1024 * 1024 + 1), 'image/png')).status, 413);
    assert.equal((await request('me/profile-appearance', 'PUT', JSON.stringify({ coverTheme: 'design' }))).status, 200);
    const profile = (await (await request('me/profile')).json()).data;
    assert.ok(profile.avatarVersion);
    assert.equal(profile.coverTheme, 'design');
    assert.equal((await request('me/profile', 'PUT', JSON.stringify({ ...profile, headline: 'Updated test headline' }))).status, 200);
    assert.equal((await (await request('me/profile')).json()).data.avatarVersion, profile.avatarVersion);
    await request('auth/demo', 'POST', JSON.stringify({ role: 'employer' })).then(response => { cookie = response.headers.get('set-cookie')!.split(';')[0]; });
    assert.equal((await request('me/profile-image/avatar')).status, 404);
    await request('auth/demo', 'POST', JSON.stringify({ role: 'student' })).then(response => { cookie = response.headers.get('set-cookie')!.split(';')[0]; });
    assert.equal((await request('me/profile-image/avatar', 'DELETE')).status, 200);
    assert.equal((await request('me/profile-image/avatar')).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    process.chdir(original);
    await rm(directory, { recursive: true, force: true });
  }
});
