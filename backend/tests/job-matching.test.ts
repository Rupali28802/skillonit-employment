import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchJob, rankJobs, matchingInputs } from '../src/lib/job-matching.js';
import { sampleJobs } from '../src/lib/fixtures.js';
import type { Profile, Preferences, User } from '../src/lib/domain.js';
import type { Repository } from '../src/lib/store.js';

const job = sampleJobs()[0];
const profile: Profile = { name: '', headline: '', skills: job.skills, experience: job.experienceMin, education: '', country: '', city: '', confirmed: true };
const preferences: Preferences = { roles: [job.title], relatedRoles: [], countries: [job.country], modes: [job.mode], exclusions: [], automation: false, dailyCap: 5 };

test('confirmed manual/CV facts produce bounded explainable scores; inputs stay unchanged', () => {
  const before = JSON.stringify({ job, profile, preferences });
  const result = matchJob(job, profile, preferences);
  assert.equal(result.score, 100);
  assert.equal(result.missingSkills.length, 0);
  assert.equal(JSON.stringify({ job, profile, preferences }), before);
  assert.equal(matchJob(job, { ...profile, skills: [...job.skills, ...job.skills] }, preferences).score, 100);
});
test('unconfirmed extraction cannot earn points or enter ranked matches', () => {
  const draft = { ...profile, confirmed: false };
  assert.equal(matchJob(job, draft, preferences).score, 0);
  assert.deepEqual(rankJobs([job], draft, preferences), []);
});
test('missing experience stays unknown and absent preferences earn no location/mode points', () => {
  const result = matchJob(job, { ...profile, experience: null, skills: [] }, { ...preferences, countries: [], modes: [] });
  assert.equal(result.score, 25);
  assert.ok(result.unknowns.includes('Candidate experience is unknown'));
  assert.equal(result.missingSkills.length, new Set(job.skills.map(s => s.toLowerCase())).size);
});
test('skill normalization deduplicates without inventing substring skills', () => {
  const result = matchJob({ ...job, skills: ['Java', ' Java ', 'SQL'] }, { ...profile, skills: ['JavaScript', ' sql '] }, preferences);
  assert.deepEqual(result.matchedSkills, ['sql']);
  assert.deepEqual(result.missingSkills, ['java']);
  assert.equal(result.breakdown.skills, 20);
});
test('company, location, mode, employment and salary exclusions prevent recommendations', () => {
  for (const patch of [
    { companyPreferences: { preferred: [], excluded: [job.company] } },
    { countries: ['Elsewhere'] }, { modes: ['Different'] }, { employmentTypes: ['Different'] },
    { salary: { min: job.salaryMax + 1, max: job.salaryMax + 2, currency: job.currency } },
  ]) assert.equal(rankJobs([job], profile, { ...preferences, ...patch }).length, 0);
});
test('currency mismatches are unknown; no invented exchange rate', () => {
  assert.ok(matchJob(job, profile, { ...preferences, salary: { min: 1, max: 2, currency: 'XXX' } }).unknowns.includes('Salary cannot be compared with your preference'));
});
test('ranking excludes unverified, expired, future, closed jobs and has stable ties', () => {
  const now = Date.now();
  const rows = [
    { ...job, id: 'b' }, { ...job, id: 'a' }, { ...job, trust: 'flagged' as const },
    { ...job, expiresAt: new Date(now - 1).toISOString() },
    { ...job, discoveredAt: new Date(now + 1000).toISOString() }, { ...job, status: 'closed' as const },
  ];
  assert.deepEqual(rankJobs(rows, profile, preferences, now).map(row => row.job.id), ['a', 'b']);
});
test('catalog IDs resolve without loading CV drafts; unconfirmed field provenance is excluded', async () => {
  const r = { get: async (collection: string, id: string) => {
    assert.ok(['locations', 'occupationFamilies'].includes(collection));
    return id === 'role-1' ? { active: true, displayName: job.title } : null;
  } } as unknown as Repository;
  const user = { profile, preferences: { ...preferences, roles: ['role-1'] }, profileProvenance: { skills: { source: 'CV_EXTRACTED', status: 'UNCONFIRMED' } } } as User;
  const input = await matchingInputs(r, user);
  assert.deepEqual(input.preferences.roles, [job.title]);
  assert.deepEqual(input.profile.skills, []);
  assert.deepEqual(user.profile.skills, profile.skills);
});
