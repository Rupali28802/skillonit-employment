import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { app } from '../src/app.js';
import type { User } from '../src/lib/domain.js';
import { hashPassword } from '../src/lib/security.js';
import { read, transaction } from '../src/lib/store.js';
import { getStudentProfileStatus, updateStudentProfile } from '../src/lib/student-profile.js';

export async function checkStudentProfile() {
  const userId = randomUUID(), otherId = randomUUID(), password = randomUUID();
  const profile = { name: 'Profile test', headline: '', skills: [], experience: 0, education: '', country: 'India', city: 'Pune', confirmed: false };
  const user: User = { id: userId, email: userId + '@example.test', name: profile.name, passwordHash: hashPassword(password), verified: true, role: 'student', plan: 'basic', createdAt: new Date().toISOString(), profile, preferences: { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 5 } };
  await transaction(async r => {
    await r.put('users', user);
    await r.put('users', { ...user, id: otherId, email: otherId + '@example.test' });
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    assert.equal((await fetch(base + '/me/profile/status')).status, 401);
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: process.env.APP_URL! }, body: JSON.stringify({ email: user.email, password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().find(c => c.startsWith('skillonit_session='))!.split(';')[0];
    const headers = { Cookie: cookie, 'Content-Type': 'application/json', Origin: process.env.APP_URL! };
    const initial = await (await fetch(base + '/me/profile/status', { headers })).json();
    assert.equal(initial.data.revision, 0);
    assert.ok(!initial.data.missingFields.includes('experience'));
    const complete = { ...profile, headline: 'Backend developer', skills: ['TypeScript'], education: 'Candidate supplied education', confirmed: true };
    const save = await fetch(base + '/me/profile', { method: 'PUT', headers, body: JSON.stringify({ ...complete, expectedRevision: 0, userId: otherId }) });
    assert.equal(save.status, 200); assert.deepEqual((await save.json()).data, complete);
    assert.deepEqual((await read(r => r.get<User>('users', otherId)))!.profile, profile);
    const status = await getStudentProfileStatus(userId);
    assert.equal(status.revision, 1); assert.equal(status.completeness, 100); assert.ok(status.confirmedAt);
    assert.equal((await read(r => r.get<User>('users', userId)))!.passwordHash, user.passwordHash);
    const stale = await fetch(base + '/me/profile', { method: 'PUT', headers, body: JSON.stringify({ ...complete, expectedRevision: 0 }) });
    assert.equal(stale.status, 409); assert.equal((await stale.json()).error.code, 'PROFILE_CONFLICT');
    const attempts = await Promise.allSettled([
      updateStudentProfile(userId, { ...complete, confirmed: false, expectedRevision: 1 }),
      updateStudentProfile(userId, { ...complete, confirmed: false, expectedRevision: 1 }),
    ]);
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await getStudentProfileStatus(userId)).confirmedAt, null);
    await assert.rejects(updateStudentProfile(userId, { ...complete, experience: -1 }));
    const logs = await read(r => r.find('auditLogs', { actorId: userId }));
    assert.ok(!JSON.stringify(logs).includes(complete.education));
    await transaction(async r => r.put('users', { ...(await r.get<User>('users', userId))!, disabled: true }));
    await assert.rejects(updateStudentProfile(userId, complete), { code: 'AUTH_REQUIRED' });
    await transaction(async r => r.put('users', { ...(await r.get<User>('users', userId))!, disabled: false, role: 'employer' }));
    await assert.rejects(updateStudentProfile(userId, complete), { code: 'FORBIDDEN' });
    await assert.rejects(updateStudentProfile(randomUUID(), complete), { code: 'AUTH_REQUIRED' });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
