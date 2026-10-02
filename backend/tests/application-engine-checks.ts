import assert from 'node:assert/strict';
import { plans, type Job, type User } from '../src/lib/domain.ts';
import { createApplication, processDueEmailApplications, publicApplication } from '../src/lib/application-engine.ts';
import { read, transaction } from '../src/lib/store.ts';

export async function checkApplicationEngine() {
  const now = new Date(), user: User = {
    id: 'application-engine-user', email: 'application-engine@example.test', name: 'Application Engine', passwordHash: 'unused',
    role: 'student', plan: 'premium', verified: true, createdAt: now.toISOString(), activeCvVersionId: 'application-cv-v1',
    profile: { name: 'Application Engine', headline: 'Developer', skills: ['TypeScript'], experience: 3, education: 'Confirmed degree', country: 'India', city: 'Pune', confirmed: true },
    preferences: { roles: ['Developer'], relatedRoles: [], countries: ['India'], modes: ['Remote'], exclusions: [], automation: false, dailyCap: 5 },
  };
  const job: Job = {
    id: 'application-direct-job', title: 'TypeScript Developer', company: 'Verified Employer', domain: 'example.test', country: 'India', state: 'Maharashtra', city: 'Pune', category: 'Technology', skills: ['TypeScript'], mode: 'Remote', type: 'Full-time', salaryMin: 1, salaryMax: 2, currency: 'INR', experienceMin: 1, experienceMax: 5,
    description: 'A confirmed direct test vacancy.', requirements: 'TypeScript', method: 'direct', status: 'published', trust: 'verified', employerId: 'application-employer', source: 'Employer submission', discoveredAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86400000).toISOString(),
  };
  await transaction(async r => {
    await r.put('users', user); await r.put('employers', { id: job.employerId, status: 'verified' }); await r.put('jobs', job);
    await r.put('studentSubscriptions', { id: user.id, userId: user.id, planCode: 'premium', status: 'active', currentPeriodStart: now.toISOString(), currentPeriodEnd: new Date(now.getTime() + 86400000).toISOString(), autoRenew: false, cancelAtPeriodEnd: false, revision: 1, source: 'admin', planSnapshot: plans[2], createdAt: now.toISOString(), updatedAt: now.toISOString(), activatedAt: now.toISOString() });
    await r.put('cvVersions', { id: 'application-cv-v1', userId: user.id, confirmed: true, documentId: 'application-cv-document', name: 'Confirmed CV', createdAt: now.toISOString(), profile: user.profile });
    await r.put('applicationTemplates', { id: user.id, subject: 'Application for {{job_title}}', body: 'Please consider my confirmed profile for {{job_title}}.', signature: '{{name}}', updatedAt: now.toISOString() });
  });
  const previousDemo = process.env.DEMO_MODE, previousEngine = process.env.ENABLE_APPLICATION_ENGINE; process.env.DEMO_MODE = 'false'; process.env.ENABLE_APPLICATION_ENGINE = 'true';
  try {
    await assert.rejects(createApplication(user.id, { jobId: job.id }, false, now), /Review and confirm/);
    const created = await createApplication(user.id, { jobId: job.id, confirmed: true }, false, now);
    assert.equal(created.created, true); assert.equal(created.application.status, 'QUEUED');
    assert.equal((await createApplication(user.id, { jobId: job.id, confirmed: true }, false, now)).created, false, 'idempotent duplicate');
    assert.equal('snapshot' in publicApplication(created.application), false);
    await processDueEmailApplications('application-engine-test-worker', 10, new Date(now.getTime() + 1000));
    const submitted = await read(r => r.get<{ status: string; events: unknown[] }>('applications', created.application.id));
    assert.equal(submitted?.status, 'DIRECT_SUBMITTED'); assert.ok((submitted?.events.length ?? 0) >= 3);
    const external = { ...job, id: 'application-external-job', method: 'external' as const, domain: 'example.com', url: 'https://ats.example.com/jobs/1', source: 'verified-ats' };
    await transaction(async r => {
      await r.put('employers', { id: job.employerId, status: 'verified', domain: 'example.com' });
      await r.put('jobs', external);
      const current = await r.get<User>('users', user.id);
      await r.put('users', { ...current!, profile: { ...current!.profile, confirmed: false, skills: [] } });
    });
    const opened = await createApplication(user.id, { jobId: external.id, confirmed: true }, false, now);
    assert.equal(opened.application.status, 'NEEDS_REVIEW'); assert.equal(opened.externalUrl, external.url, JSON.stringify(opened.application.reviewReasons));
    const reopened = await createApplication(user.id, { jobId: external.id, confirmed: true }, false, now);
    assert.equal(reopened.created, false); assert.equal(reopened.externalUrl, external.url, 'repeat Apply reopens the source form');
    await transaction(async r => { const current = await r.get<User>('users', user.id); await r.put('users', { ...current!, activeCvVersionId: null, profile: user.profile }); await r.put('jobs', { ...job, id: 'application-missing-cv-job' }); });
    const review = await createApplication(user.id, { jobId: 'application-missing-cv-job', confirmed: true });
    assert.equal(review.application.status, 'NEEDS_REVIEW'); assert.ok(review.application.reviewReasons?.includes('CONFIRMED_CV_REQUIRED'));
  } finally { process.env.DEMO_MODE = previousDemo; process.env.ENABLE_APPLICATION_ENGINE = previousEngine; }
}
