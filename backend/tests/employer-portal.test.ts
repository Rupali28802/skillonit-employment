import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Job, User } from '../src/lib/domain.ts';

test('employer portal enforces ownership, revisions, verification, jobs and applicant management', async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replica.getUri(); process.env.MONGODB_DATABASE = 'employer_portal_test'; process.env.DEMO_MODE = 'true';
  const store = await import('../src/lib/store.ts');
  const portal = await import('../src/lib/employer-portal.ts');
  const blank = { name: '', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false };
  const preferences = { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 5 };
  const employer = (id: string): User => ({ id, email: `${id}@example.test`, name: id, passwordHash: null, role: 'employer', plan: 'basic', verified: true, createdAt: new Date().toISOString(), profile: blank, preferences });
  const admin: User = { ...employer('admin'), role: 'admin' };
  try {
    await store.bootstrapIndexes();
    await store.transaction(async r => { await r.put('users', employer('employer-one')); await r.put('users', employer('employer-two')); await r.put('users', admin); });
    const profile = await portal.createEmployerProfile('employer-one', { name: 'Example Company', domain: 'example.test', country: 'India', description: 'A verified test organization.', website: 'https://careers.example.test', industry: 'Software', companySize: '51-200', headquarters: 'Pune' });
    assert.equal(profile.revision, 0); assert.equal(profile.status, 'pending');
    await assert.rejects(portal.createEmployerProfile('employer-two', { name: 'Imposter', domain: 'example.test', country: 'India', description: '' }), { code: 'DOMAIN_IN_USE' });
    const updated = await portal.updateEmployerProfile('employer-one', { expectedRevision: 0, description: 'Updated candidate-safe company description.' });
    assert.equal(updated.revision, 1);
    await assert.rejects(portal.updateEmployerProfile('employer-one', { expectedRevision: 0, description: 'Stale edit' }), { code: 'EMPLOYER_PROFILE_CONFLICT' });
    const verification = await portal.submitEmployerVerification('employer-one', { expectedRevision: 0, evidence: [{ type: 'domain', reference: 'example.test' }, { type: 'website', reference: 'https://careers.example.test' }] });
    assert.equal(verification.evidence.length, 2);
    await store.transaction(r => portal.recordEmployerVerificationDecision(r, 'employer-one', admin.id, 'verified', 'Evidence reviewed.'));
    assert.equal((await portal.getEmployerProfile('employer-one'))?.status, 'verified');

    const now = new Date();
    const job: Job & { revision: number } = { id: 'job-one', title: 'Engineer', company: 'Example Company', domain: 'example.test', country: 'India', state: 'Maharashtra', city: 'Pune', category: 'Technology', skills: ['TypeScript'], mode: 'Remote', type: 'Full-time', salaryMin: 1, salaryMax: 2, currency: 'INR', experienceMin: 1, experienceMax: 3, description: 'Build secure services for customers and maintain reliable systems.', requirements: 'TypeScript and API engineering experience.', method: 'direct', status: 'review', trust: 'pending', employerId: 'employer-one', source: 'Employer submission', discoveredAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86400000).toISOString(), lifecycle: { schemaVersion: 1, state: 'publishing', revision: 0, changedAt: now.toISOString(), reasonCode: 'EMPLOYER_SUBMITTED' }, revision: 0 };
    await store.transaction(r => r.put('jobs', job));
    const edited = await portal.updateEmployerJob('employer-one', job.id, { expectedRevision: 0, title: 'Senior Engineer' });
    assert.equal(edited.title, 'Senior Engineer'); assert.equal(edited.status, 'review');
    await assert.rejects(portal.getEmployerJob('employer-two', job.id), { code: 'NOT_FOUND' });

    const application = { id: 'application-one', userId: 'candidate', jobId: job.id, employerId: 'employer-one', method: 'direct', status: 'DIRECT_SUBMITTED', priority: 1, createdAt: now.toISOString(), scheduledAt: now.toISOString(), jobVerifiedAt: now.toISOString(), attempts: 0, maxAttempts: 3, job: { title: job.title, country: job.country, city: job.city }, events: [], snapshot: { profile: { name: 'Candidate', headline: 'Engineer', skills: ['TypeScript'], experience: 2, education: '', country: 'India', city: 'Pune' }, cvVersion: { id: 'cv-one', name: 'CV' } } } as const;
    await store.transaction(r => r.put('applications', application));
    assert.equal((await portal.listEmployerApplicants('employer-one')).length, 1);
    assert.equal((await portal.listEmployerApplicants('employer-two')).length, 0);
    await assert.rejects(portal.getEmployerApplicant('employer-two', application.id), { code: 'NOT_FOUND' });
    await portal.addApplicantNote('employer-one', application.id, { note: 'Strong TypeScript experience.' });
    assert.equal((await portal.listApplicantNotes('employer-one', application.id)).length, 1);
    const moved = await portal.updateApplicantStatus('employer-one', application.id, 'SHORTLISTED', 'DIRECT_SUBMITTED');
    assert.equal(moved.status, 'SHORTLISTED');
    await assert.rejects(portal.updateApplicantStatus('employer-one', application.id, 'INTERVIEW', 'DIRECT_SUBMITTED'), { code: 'APPLICANT_CONFLICT' });
    const closed = await portal.closeEmployerJob('employer-one', job.id); assert.equal(closed.status, 'closed');
  } finally { await store.closeStore(); await replica.stop(); delete process.env.MONGODB_URI; delete process.env.MONGODB_DATABASE; }
});
