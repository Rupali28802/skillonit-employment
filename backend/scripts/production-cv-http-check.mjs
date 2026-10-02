import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { hashPassword } from '../dist/lib/security.js';
import { transaction, closeStore } from '../dist/lib/store.js';

const base = 'http://127.0.0.1:4100/api/v1';
const origin = 'https://employment.skillonit.com';
const suffix = randomUUID();
const userId = `cv-http-check-${suffix}`;
const email = `${userId}@example.invalid`;
const password = `CvEndpoint-${suffix}!`;
let cookie = '';
let documentId;
const report = { login: false, invalidFile: false, oversizedFile: false, upload: false, worker: false, review: false, download: false, confirmation: false, canonicalProfile: false, deletion: false, cleanup: false };

async function request(path, init = {}) {
  return fetch(base + path, { ...init, headers: { origin, 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}), ...(init.headers || {}) } });
}

try {
  const now = new Date().toISOString();
  await transaction(r => r.put('users', { id: userId, email, name: 'CV HTTP Check', passwordHash: hashPassword(password), role: 'student', plan: 'basic', verified: true, disabled: false, createdAt: now, profile: { name: '', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false }, profileRevision: 0, preferences: { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 0 } }));

  const login = await request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200); cookie = (login.headers.get('set-cookie') || '').split(';', 1)[0]; assert.ok(cookie); report.login = true;

  const invalid = await request('/me/cv', { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-file-name': 'invalid.pdf' }, body: Buffer.from('not a PDF') });
  assert.equal(invalid.status, 415); report.invalidFile = true;

  const oversized = await request('/me/cv', { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-file-name': 'oversized.pdf', 'content-length': String(5 * 1024 * 1024 + 1) }, body: Buffer.alloc(5 * 1024 * 1024 + 1) });
  assert.equal(oversized.status, 413); report.oversizedFile = true;

  const pdf = await PDFDocument.create(); const page = pdf.addPage([612, 792]); const font = await pdf.embedFont(StandardFonts.Helvetica);
  ['ALEX HTTP PRODUCTION CHECK','Backend Engineer','alex.http.check@example.invalid | Pune, India','SUMMARY','Backend engineer building reliable services.','SKILLS','TypeScript, PostgreSQL, Node.js, REST APIs','EXPERIENCE','Backend Engineer, Example Validation Ltd, January 2022 - Present','Built reliable services and PostgreSQL applications.','EDUCATION','B.Tech Computer Science, Example University, 2021'].forEach((line, index) => page.drawText(line, { x: 55, y: 740 - index * 32, size: index === 0 ? 18 : 11, font }));
  const bytes = Buffer.from(await pdf.save());
  const upload = await request('/me/cv', { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-file-name': 'controlled-http-check.pdf' }, body: bytes });
  assert.equal(upload.status, 202); const uploaded = await upload.json(); documentId = uploaded.data.id; report.upload = true;

  let cv;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await request(`/me/cv/${documentId}`); assert.equal(response.status, 200); cv = (await response.json()).data;
    if (cv.status === 'review' || cv.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.equal(cv?.status, 'review'); assert.equal(cv.scanStatus, 'CLEAN'); assert.equal(cv.extractionStatus, 'EXTRACTED'); report.worker = true; report.review = true;

  const content = await request(`/me/cv/${documentId}/content`); assert.equal(content.status, 200); const downloaded = (await content.json()).data; assert.equal(Buffer.from(downloaded.base64, 'base64').equals(bytes), true); report.download = true;

  const { confirmed: _marker, ...profile } = cv.draft;
  const confirmed = await request(`/me/cv/${documentId}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile, confirmed: true, expectedRevision: cv.revision, expectedProfileRevision: 0, name: 'Controlled HTTP CV', targetRoles: ['Backend Engineer'], summary: 'Controlled production endpoint verification.' }) });
  assert.equal(confirmed.status, 200); report.confirmation = true;

  const profileResponse = await request('/me/profile'); assert.equal(profileResponse.status, 200); const canonical = (await profileResponse.json()).data; assert.equal(canonical.confirmed, true); report.canonicalProfile = true;

  const deletion = await request(`/me/cv/${documentId}`, { method: 'DELETE' }); assert.equal(deletion.status, 200); documentId = undefined; report.deletion = true;
} finally {
  if (documentId && cookie) { try { await request(`/me/cv/${documentId}`, { method: 'DELETE' }); } catch {} }
  await transaction(async r => {
    for (const collection of ['sessions', 'auditLogs', 'cvDocuments', 'cvDeletionReceipts', 'cvVersions']) {
      for (const row of await r.find(collection, { userId }, 1000)) await r.remove(collection, row.id);
    }
    await r.remove('users', userId);
  });
  await closeStore(); report.cleanup = true; console.log(JSON.stringify(report));
}
if (Object.values(report).some(value => !value)) process.exitCode = 1;
