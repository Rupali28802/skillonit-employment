import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Job, User } from '../src/lib/domain.ts';

const candidate: User = {
  id: 'candidate', email: 'candidate@example.test', name: 'Candidate Private Name', passwordHash: null, role: 'student', plan: 'premium', verified: true, createdAt: '2026-01-01T00:00:00.000Z',
  profile: { name: 'Candidate Private Name', headline: 'Backend Engineer', skills: ['TypeScript'], experience: 3, education: 'BSc', country: 'India', city: 'Pune', confirmed: true },
  preferences: { roles: ['Backend Engineer'], relatedRoles: [], countries: ['India'], modes: ['Remote'], exclusions: [], automation: false, dailyCap: 5 },
};
const other: User = { ...candidate, id: 'other', email: 'other@example.test', name: 'Other User' };
const job: Job = {
  id: 'job-one', title: 'Backend Engineer', company: 'Example Corp', domain: 'example.test', country: 'India', state: 'Maharashtra', city: 'Pune', category: 'Technology', skills: ['TypeScript'], mode: 'Remote', type: 'Full-time', salaryMin: 100, salaryMax: 200, currency: 'INR', experienceMin: 2, experienceMax: 5,
  description: 'Build verified backend services.', requirements: 'Three years of TypeScript experience.', method: 'external', url: 'https://careers.example.test/jobs/one', status: 'published', trust: 'verified', employerId: 'employer-one', source: 'verified-source', discoveredAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z', matching: { requiredSkills: ['TypeScript'], requiredEducationLevels: ['BSc'] },
};

test('assistant answers only grounded supported use cases with consent, ownership and private audit controls', async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replica.getUri(); process.env.MONGODB_DATABASE = 'assistant_test'; process.env.DEMO_MODE = 'true';
  const store = await import('../src/lib/store.ts'); const assistant = await import('../src/lib/ai-assistant.ts');
  try {
    await store.bootstrapIndexes();
    await store.transaction(async r => {
      await r.put('users', candidate); await r.put('users', other); await r.put('jobs', job);
      await r.put('employers', { id: 'employer-one', status: 'verified', domain: 'example.test', website: 'https://example.test' });
      await r.put('candidateConsents', { id: `${candidate.id}:profile`, userId: candidate.id, purpose: 'profile', granted: true });
      await r.put('applications', { id: 'application-one', userId: candidate.id, jobId: job.id, employerId: job.employerId, method: 'external', status: 'EXTERNAL_STARTED', priority: 1, createdAt: '2026-09-02T00:00:00.000Z', scheduledAt: '2026-09-02T00:00:00.000Z', jobVerifiedAt: '2026-09-02T00:00:00.000Z', attempts: 0, maxAttempts: 3, job: { title: job.title, country: job.country, city: job.city }, events: [{ status: 'EXTERNAL_STARTED', at: '2026-09-02T00:00:00.000Z', actorId: candidate.id }], snapshot: { private: true }, delivery: { destination: job.url } });
    });
    const search = await assistant.runAssistant(candidate, { message: 'Backend Engineer' });
    assert.equal(search.intent, 'job_search'); assert.equal(search.mode, 'keyword-search'); assert.equal(search.jobs.length, 1);
    const qualification = await assistant.runAssistant(candidate, { message: 'What qualifications are required?', jobId: job.id });
    assert.equal(qualification.intent, 'qualifications'); assert.match(qualification.answer, /Three years/);
    await assert.rejects(assistant.runAssistant(candidate, { message: 'Can I apply?', jobId: job.id }), { code: 'ASSISTANT_CONSENT_REQUIRED' });
    await store.transaction(r => r.put('candidateConsents', { id: `${candidate.id}:assistant`, userId: candidate.id, purpose: 'assistant', granted: true }));
    let providerFacts: string[] = [];
    const provider: assistant.AssistantProvider = { async complete(input) { providerFacts = input.facts; return 'Grounded provider response.'; } };
    const eligibility = await assistant.runAssistant(candidate, { message: 'Can I apply with my private email candidate@example.test?', jobId: job.id }, provider);
    assert.equal(eligibility.intent, 'eligibility'); assert.equal(eligibility.mode, 'provider_grounded'); assert.equal(eligibility.answer, 'Grounded provider response.');
    assert.equal(JSON.stringify(providerFacts).includes(candidate.email), false); assert.equal(JSON.stringify(providerFacts).includes(candidate.name), false);
    const status = await assistant.runAssistant(candidate, { message: 'Where is my application?', applicationId: 'application-one' });
    assert.equal(status.intent, 'application_status'); assert.match(status.answer, /EXTERNAL_STARTED/);
    await assert.rejects(assistant.runAssistant(other, { message: 'Where is my application?', applicationId: 'application-one' }), { code: 'ASSISTANT_CONSENT_REQUIRED' });
    await store.transaction(r => r.put('candidateConsents', { id: `${other.id}:assistant`, userId: other.id, purpose: 'assistant', granted: true }));
    await assert.rejects(assistant.runAssistant(other, { message: 'Where is my application?', applicationId: 'application-one' }), { code: 'APPLICATION_NOT_FOUND' });
    const official = await assistant.runAssistant(candidate, { message: 'Give me the official apply link', jobId: job.id });
    assert.equal(official.officialUrl, job.url);
    const interactions = await store.read(r => r.find<Record<string, unknown>>('assistantInteractions', { userId: candidate.id }, 20));
    assert.ok(interactions.length >= 5); const serialized = JSON.stringify(interactions);
    assert.equal(serialized.includes(candidate.email), false); assert.equal(serialized.includes('private email'), false); assert.equal(serialized.includes('Grounded provider response'), false);
  } finally { await store.closeStore(); await replica.stop(); delete process.env.MONGODB_URI; delete process.env.MONGODB_DATABASE; }
});

test('Gemini assistant adapter validates endpoint, credentials and response contract without exposing provider errors', async () => {
  const assistant = await import('../src/lib/ai-assistant.ts');
  assert.equal(assistant.assistantProviderConfig({ AI_ASSISTANT_PROVIDER: 'none' } as NodeJS.ProcessEnv), null);
  assert.throws(() => assistant.assistantProviderConfig({ AI_ASSISTANT_PROVIDER: 'gemini', AI_ASSISTANT_URL: 'https://evil.example/generate', AI_ASSISTANT_TOKEN: 'private-test-token-123', AI_ASSISTANT_MODEL: 'gemini-2.5-flash' } as NodeJS.ProcessEnv), { code: 'ASSISTANT_PROVIDER_INVALID' });
  const config = assistant.assistantProviderConfig({ AI_ASSISTANT_PROVIDER: 'gemini', AI_ASSISTANT_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', AI_ASSISTANT_TOKEN: 'private-test-token-123', AI_ASSISTANT_MODEL: 'gemini-2.5-flash', AI_ASSISTANT_TIMEOUT_MS: '1000' } as NodeJS.ProcessEnv);
  assert.equal(config?.provider, 'gemini'); assert.equal(config?.timeoutMs, 1000);
});
