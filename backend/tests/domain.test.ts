import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleJobs } from '../src/lib/fixtures.ts';
import {
  publicJob,
  isRecent,
  canTransition,
  eligibility,
  matchJob,
  plans,
  type User,
} from '../src/lib/domain.ts';
import {
  fingerprint,
  classifyRisk,
  renderTemplate,
  retryDelay,
} from '../src/lib/pipeline.ts';
const job = sampleJobs()[0];
const user: User = {
  id: 'test-user',
  name: 'Test',
  email: 'test@example.test',
  passwordHash: 'unused',
  role: 'student',
  plan: 'pro',
  verified: true,
  createdAt: new Date().toISOString(),
  profile: {
    name: 'Test',
    headline: 'Developer',
    skills: ['React', 'TypeScript', 'CSS'],
    experience: 2,
    education: '',
    country: 'India',
    city: 'Bengaluru',
    confirmed: true,
  },
  preferences: {
    roles: ['Developer'],
    relatedRoles: [],
    countries: ['India'],
    modes: ['Hybrid'],
    exclusions: [],
    automation: false,
    dailyCap: 5,
  },
};
await test('gated public payload contains no company, email, domain or application URL', () => {
  const safe = publicJob({
    ...job,
    email: 'hiring@example.com',
    url: 'https://example.com/private',
  });
  assert.equal(safe.identityVisible, false);
  assert.equal(safe.company, 'Company identity protected');
  assert.ok(!JSON.stringify(safe).includes('hiring@example.com'));
  assert.ok(!('domain' in safe));
  assert.ok(!('url' in safe));
});
await test('plan controls employer identity and grants no admin privileges', () => {
  assert.equal(
    publicJob(job, { ...user, plan: 'basic' }).identityVisible,
    false,
  );
  assert.equal(publicJob(job, user).identityVisible, true);
});
await test('90-day lifecycle excludes stale and closed vacancies', () => {
  assert.equal(isRecent(job), true);
  assert.equal(
    isRecent({
      ...job,
      discoveredAt: new Date(Date.now() - 91 * 86400000).toISOString(),
    }),
    false,
  );
  assert.equal(
    isRecent({
      ...job,
      discoveredAt: new Date().toISOString(),
      sourcePostedAt: new Date(Date.now() - 91 * 86400000).toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }),
    false,
  );
  assert.equal(isRecent({ ...job, status: 'closed' }), false);
});
await test('matching uses profile fallback location and detailed preferences', () => {
  const tailored = matchJob(
    {
      ...job,
      country: 'United States',
      eligibleCountries: ['India', 'United States'],
      category: 'Technology',
      type: 'Full-time',
      skills: ['React', 'TypeScript'],
    },
    user.profile,
    {
      ...user.preferences,
      countries: [],
      modes: [],
      skills: ['TypeScript'],
      employmentTypes: ['Full-time'],
      industries: ['Technology'],
    },
  );
  assert.ok(tailored.score > 0);
  assert.ok(tailored.reasons.includes('Location fits'));
  assert.ok(tailored.reasons.includes('Employment type fits'));
  assert.ok(tailored.reasons.includes('Industry fits'));
});
await test('opening an external application never counts as submitted', () => {
  assert.equal(canTransition('EXTERNAL_STARTED', 'EXTERNAL_SUBMITTED'), true);
  assert.equal(canTransition('EXTERNAL_STARTED', 'SENT'), false);
  assert.equal(canTransition('REJECTED', 'QUEUED'), false);
});
await test('eligibility separates verification, profile, quota and mail consent', () => {
  assert.deepEqual(eligibility(user, job, plans[1], 0), []);
  assert.ok(eligibility({ ...user, verified: false }, job, plans[1], 0).length);
  assert.ok(
    eligibility(user, { ...job, trust: 'flagged' }, plans[1], 0).length,
  );
  assert.ok(eligibility(user, job, plans[1], 25).length);
  assert.ok(
    eligibility(user, { ...job, method: 'email' }, plans[1], 0, false).length,
  );
});
await test('matching is explainable and respects exclusions', () => {
  const match = matchJob(job, user.profile, user.preferences);
  assert.equal(match.score, 100);
  assert.ok(match.reasons.includes('3 matching skills'));
  assert.equal(
    matchJob(job, user.profile, {
      ...user.preferences,
      exclusions: ['Frontend'],
    }).score,
    0,
  );
});
await test('dedupe fingerprints normalize case and spaces', () => {
  assert.equal(
    fingerprint(job),
    fingerprint({ ...job, title: '  FRONTEND   DEVELOPER ' }),
  );
});
await test('risk controls reject suspicious destination or payment demands', () => {
  assert.equal(
    classifyRisk({ ...job, email: 'hiring@imposter.test' }).level,
    'high',
  );
  assert.equal(
    classifyRisk({ ...job, description: 'Pay a registration fee now' }).level,
    'high',
  );
});
await test('templates reject unsupported invented facts', () => {
  assert.equal(
    renderTemplate('Hello {{name}}', { name: 'Asha', job_title: 'Developer' }),
    'Hello Asha',
  );
  assert.throws(() =>
    renderTemplate('{{degree}}', { name: 'Asha', job_title: 'Developer' }),
  );
});
await test('retry backoff is bounded', () => {
  assert.equal(retryDelay(0), 1000);
  assert.ok(retryDelay(100) <= 3600000);
});
await test('identity gating also scrubs employer mentions and contacts from narrative fields', () => {
  const gated = publicJob({
    ...job,
    description: `Join ${job.company} at ${job.domain}, email jobs@other.example or https://private.example/apply`,
  });
  assert.ok(!gated.description.includes(job.company));
  assert.ok(!gated.description.includes(job.domain));
  assert.ok(!gated.description.includes('jobs@'));
  assert.ok(!gated.description.includes('https://'));
});
