import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { productionCvProviders } from '../dist/lib/cv-production.js';
import { uploadCv, processCv, getCv, confirmCv, downloadCv, deleteCv } from '../dist/lib/cv-service.js';
import { read, transaction, closeStore } from '../dist/lib/store.js';

const suffix = randomUUID(); const userId = `cv-production-check-${suffix}`;
const now = new Date().toISOString(); let documentId;
const report = { userCreated: false, upload: false, storage: false, scanner: false, parser: false, review: false, confirmation: false, canonicalProfile: false, version: false, audit: false, downloadIntegrity: false, cleanup: false };
try {
  await transaction(r => r.put('users', { id: userId, email: `${userId}@example.invalid`, name: 'CV Production Check', passwordHash: null, role: 'student', plan: 'basic', verified: true, disabled: false, createdAt: now, profile: { name: '', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false }, profileRevision: 0, preferences: { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 0 } })); report.userCreated = true;
  const pdf = await PDFDocument.create(); const page = pdf.addPage([612, 792]); const font = await pdf.embedFont(StandardFonts.Helvetica);
  ['ALEX PRODUCTION CHECK','Backend Engineer','alex.production.check@example.invalid | Pune, India','SUMMARY','Backend engineer building reliable services.','SKILLS','TypeScript, PostgreSQL, Node.js, REST APIs','EXPERIENCE','Backend Engineer, Example Validation Ltd, January 2022 - Present','Built reliable services and PostgreSQL applications.','EDUCATION','B.Tech Computer Science, Example University, 2021'].forEach((line, index) => page.drawText(line, { x: 55, y: 740 - index * 32, size: index === 0 ? 18 : 11, font }));
  const bytes = await pdf.save(); const providers = productionCvProviders();
  const queued = await uploadCv(userId, 'controlled-production-check.pdf', 'application/pdf', bytes, providers); documentId = queued.id; assert.equal(queued.status, 'queued'); report.upload = true; report.storage = true;
  assert.equal(await processCv(documentId, providers), true);
  const review = await getCv(userId, documentId); assert.equal(review.status, 'review'); assert.equal(review.scanStatus, 'CLEAN'); assert.equal(review.extractionStatus, 'EXTRACTED'); assert.ok(review.draft); report.scanner = true; report.parser = true; report.review = true;
  const { confirmed: _draftMarker, ...reviewedProfile } = review.draft;
  const version = await confirmCv(userId, documentId, { profile: reviewedProfile, confirmed: true, expectedRevision: review.revision, expectedProfileRevision: 0, name: 'Controlled production CV', targetRoles: ['Backend Engineer'], summary: 'Controlled production workflow verification.' }); assert.equal(version.confirmed, true); report.confirmation = true;
  const user = await read(r => r.get('users', userId)); assert.equal(user?.profile?.confirmed, true); assert.equal(user?.activeCvVersionId, version.id); report.canonicalProfile = true;
  assert.ok(await read(r => r.get('cvVersions', version.id))); report.version = true;
  const actions = await read(r => r.find('auditLogs', { actorId: userId }, 20)); for (const action of ['cv.upload_reserved','cv.review_ready','cv.confirmed']) assert.ok(actions.some(row => row.action === action)); report.audit = true;
  const downloaded = await downloadCv(userId, documentId, providers); assert.equal(Buffer.from(downloaded.base64, 'base64').equals(Buffer.from(bytes)), true); report.downloadIntegrity = true;
  await deleteCv(userId, documentId, providers); documentId = undefined; report.cleanup = true;
} finally {
  if (documentId) { try { await deleteCv(userId, documentId, productionCvProviders()); } catch {} }
  await transaction(async r => { for (const version of await r.find('cvVersions', { userId }, 100)) await r.remove('cvVersions', version.id); await r.remove('users', userId); });
  await closeStore(); console.log(JSON.stringify(report));
}
if (Object.values(report).some(value => !value)) process.exitCode = 1;
