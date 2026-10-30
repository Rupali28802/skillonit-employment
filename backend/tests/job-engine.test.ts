import { test, before, after, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { countryEntries, countriesInLocation, normalizeCountry } from '../src/lib/countries.ts';
import { coverageReport, saveCoverageAudit } from '../src/job-engine/coverage.ts';
import { worldwideSources } from '../src/job-engine/sources.ts';
import { reserveJoobleRequest, JOOBLE_REQUEST_LIMIT } from '../src/job-engine/jooble-budget.ts';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { bootstrapIndexes, closeStore, read, transaction } from '../src/lib/store.ts';
import { sampleJobs } from '../src/lib/fixtures.ts';
import { publicJob, type Job } from '../src/lib/domain.ts';
import { sourceSchema, publicSources, type FeedSource } from '../src/job-engine/sources.ts';
import { canonicalUrl, normalize, categoryFor } from '../src/job-engine/normalize.ts';
import { fetchFeed, FeedError, githubApplicationUrl, type Candidate, type FeedBatch } from '../src/job-engine/adapters.ts';
import { engineLeaseDurationMs, runEngine, upsertSource, setEmployerRefresh } from '../src/job-engine/engine.ts';
import { searchJobs } from '../src/lib/search.ts';
import { expireJobs, expectedJobExpiry } from '../src/lib/lifecycle.ts';
import { minimumFastSources } from '../src/job-engine/discovery-health.ts';

let replica: MongoMemoryReplSet, client: MongoClient;
const source: FeedSource = { id: 'test-board', type: 'ashby', name: 'Test employer', company: 'Example Employer', board: 'example',
  enabled: true, approved: true, publicListing: true, publish: true, policyEvidence: 'Explicit fixture permission for isolated tests only.', intervalMinutes: 30, maxPages: 2 };
const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({ externalId: 'role-1', title: 'Clinical nurse', company: 'Example Employer',
  url: 'https://careers.example.com/jobs/role-1', description: '<p>Provide excellent patient care &amp; support the clinical team.</p>',
  location: 'London, United Kingdom', postedAt: new Date(Date.now() - 86400000).toISOString(), ...overrides });
const batch = (jobs = [candidate()], overrides: Partial<FeedBatch> = {}): FeedBatch => ({ jobs, complete: true, snapshot: true, requests: 1, ...overrides });
const joobleSource = (): FeedSource => sourceSchema.parse({ ...source, id: 'jooble-gb', type: 'jooble', countryCode: 'gb', intervalMinutes: 1440, maxPages: 1 });

test('reviewed employer manifest contains unique, approved public ATS boards', async () => {
  const manifest = JSON.parse(await readFile(new URL('../job-sources.employers.json', import.meta.url), 'utf8')) as unknown[];
  const sources = manifest.map(sourceSchema.parse);
  assert.equal(new Set(sources.map(source => source.id)).size, sources.length);
  assert.ok(sources.length >= 11);
  for (const item of sources) {
    assert.ok(['ashby', 'greenhouse', 'lever'].includes(item.type));
    assert.equal(item.enabled, true); assert.equal(item.approved, true); assert.equal(item.publicListing, true);
    assert.ok(item.board); assert.ok(item.company); assert.ok(item.policyEvidence.includes('https://'));
  }
  assert.ok(sources.some(source => source.id === 'greenhouse-superapp'));
  assert.ok(sources.some(source => source.id === 'ashby-handshake'));
});

test('jobs expire 90 days after posting or at an earlier employer close date', () => {
  const now = Date.parse('2026-09-17T12:00:00.000Z');
  const postedAt = new Date(now - 10 * 86400000).toISOString();
  const ninetyDayExpiry = new Date(Date.parse(postedAt) + 90 * 86400000).toISOString();
  assert.equal(normalize(candidate({ postedAt }), source, now).expiresAt, ninetyDayExpiry);

  const closesAt = new Date(now + 7 * 86400000).toISOString();
  assert.equal(normalize(candidate({ postedAt, closesAt }), source, now).expiresAt, closesAt);

  const withoutPostedDate = normalize(candidate({ postedAt: undefined }), source, now);
  assert.equal(withoutPostedDate.expiresAt, new Date(now + 90 * 86400000).toISOString());
});

test('discovery lease spans the configured cycle with a bounded handoff margin', () => {
  const prior = process.env.JOB_ENGINE_CYCLE_MAX_MS;
  try {
    delete process.env.JOB_ENGINE_CYCLE_MAX_MS;
    assert.equal(engineLeaseDurationMs(), 540_000);
    process.env.JOB_ENGINE_CYCLE_MAX_MS = '60000';
    assert.equal(engineLeaseDurationMs(), 300_000);
    process.env.JOB_ENGINE_CYCLE_MAX_MS = '1200000';
    assert.equal(engineLeaseDurationMs(), 1_260_000);
  } finally {
    if (prior === undefined) delete process.env.JOB_ENGINE_CYCLE_MAX_MS;
    else process.env.JOB_ENGINE_CYCLE_MAX_MS = prior;
  }
});

test('discovery health requires an explicit valid fast-source floor outside local defaults', () => {
  assert.equal(minimumFastSources({}), 1);
  assert.equal(minimumFastSources({ DISCOVERY_MIN_FAST_SOURCES: '22' }), 22);
  assert.throws(() => minimumFastSources({ DISCOVERY_MIN_FAST_SOURCES: '0' }), /DISCOVERY_HEALTH_MIN_FAST_SOURCES_INVALID/);
  assert.throws(() => minimumFastSources({ DISCOVERY_MIN_FAST_SOURCES: 'two' }), /DISCOVERY_HEALTH_MIN_FAST_SOURCES_INVALID/);
});

test('expiry scans past a full fresh page and closes only expired jobs', async () => {
  const base = normalize(candidate(), source);
  await transaction(r => r.putMany('jobs', Array.from({ length: 302 }, (_, i) => ({ ...base, id: `expiry-${String(i).padStart(4, '0')}`,
    ...(i >= 300 ? {
      discoveredAt: new Date(Date.now() - 91 * 86400000).toISOString(),
      sourcePostedAt: new Date(Date.now() - 91 * 86400000).toISOString(),
      expiresAt: new Date(Date.now() - 86400000).toISOString(),
    } : {}) }))));
  assert.equal(await expireJobs(), 2);
  assert.equal(await read(r => r.count('jobs', { status: 'published' })), 300);
  assert.equal(await expireJobs(), 0);
});

test('retention repairs legacy short feed deadlines without changing the posting date', async () => {
  const job = normalize(candidate(), source);
  const legacy = { ...job, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  await transaction(r => r.put('jobs', legacy));
  assert.equal(await expireJobs(), 0);
  const repaired = await read(r => r.get<Job>('jobs', job.id));
  assert.equal(repaired?.expiresAt, expectedJobExpiry(job));
  assert.equal(repaired?.sourcePostedAt, job.sourcePostedAt);
});

test('Jooble uses regional POST, preserves referral links and does not invent posting dates or eligibility', async () => {
  const old = process.env.JOOBLE_GB_API_KEY; process.env.JOOBLE_GB_API_KEY = 'fixture-key';
  try {
    const result = await fetchFeed(joobleSource(), async (url, headers, body) => {
      assert.equal(url, 'https://uk.jooble.org/api/fixture-key');
      assert.equal(headers?.['Content-Type'], 'application/json');
      assert.deepEqual(body, { keywords: '', location: 'United Kingdom', page: 1, ResultOnPage: 100 });
      return { totalCount: 5000, jobs: [{ id: 7, title: 'School teacher', company: 'School',
        snippet: 'Help children learn in a supportive classroom setting.', location: 'London', type: 'Part-time',
        link: 'https://uk.jooble.org/jdp/7?source=partner', updated: new Date().toISOString() }] };
    }, async () => undefined, async region => { assert.equal(region, 'gb'); return true; });
    assert.equal(result.requests, 1); assert.equal(result.complete, false); assert.equal(result.snapshot, false);
    const job = normalize(result.jobs[0], joobleSource());
    assert.equal(job.category, 'Education'); assert.equal(job.sourcePostedAt, undefined);
    assert.equal(job.country, 'Not specified'); assert.equal(job.url, 'https://uk.jooble.org/jdp/7?source=partner');
  } finally { if (old === undefined) delete process.env.JOOBLE_GB_API_KEY; else process.env.JOOBLE_GB_API_KEY = old; }
});

test('Jooble missing credentials and exhausted quota make no HTTP call; transport errors hide keys', async () => {
  const old = process.env.JOOBLE_GB_API_KEY; delete process.env.JOOBLE_GB_API_KEY;
  let calls = 0;
  const get = async () => { calls++; throw Error('credential-bearing URL fixture-key'); };
  try {
    await assert.rejects(fetchFeed(joobleSource(), get), /MISSING_JOOBLE_CREDENTIALS/);
    process.env.JOOBLE_GB_API_KEY = 'fixture-key';
    await assert.rejects(fetchFeed(joobleSource(), get, async () => undefined, async () => false), /JOOBLE_BUDGET_EXHAUSTED/);
    assert.equal(calls, 0);
    await assert.rejects(fetchFeed(joobleSource(), get, async () => undefined, async () => true), { message: 'JOOBLE_REQUEST_FAILED' });
    assert.equal(sourceSchema.safeParse({ ...joobleSource(), countryCode: 'xx' }).success, false);
    assert.equal(sourceSchema.safeParse({ ...joobleSource(), maxPages: 2 }).success, false);
    assert.equal(sourceSchema.safeParse({ ...joobleSource(), intervalMinutes: 60 }).success, false);
  } finally { if (old === undefined) delete process.env.JOOBLE_GB_API_KEY; else process.env.JOOBLE_GB_API_KEY = old; }
});

test('Jooble quota persists in MongoDB, is regional and cannot exceed its cap concurrently', async () => {
  await transaction(r => r.put('jobEngineState', { id: 'jooble-budget-gb', used: JOOBLE_REQUEST_LIMIT - 1 }));
  const results = await Promise.all([reserveJoobleRequest('gb'), reserveJoobleRequest('gb')]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await reserveJoobleRequest('gb'), false);
  assert.equal(await reserveJoobleRequest('in'), true);
  assert.equal((await read(r => r.get<any>('jobEngineState', 'jooble-budget-gb'))).used, JOOBLE_REQUEST_LIMIT);
});
async function due(id = source.id) { await transaction(async r => { const s = await r.get<any>('jobFeedStates', id); await r.put('jobFeedStates', { ...s, id, nextRunAt: 0 }); }); }
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  Object.assign(process.env, { MONGODB_URI: replica.getUri(), MONGODB_DATABASE: 'job_engine_isolated_tests', DEMO_MODE: 'false', NODE_ENV: 'test' });
  client = new MongoClient(replica.getUri()); await bootstrapIndexes();
});
beforeEach(async () => {
  for (const c of ['jobs', 'jobFeedSources', 'jobFeedStates', 'jobFeedVariants', 'jobFeedFingerprints', 'jobFeedRuns', 'jobEngineState'])
    await client.db('job_engine_isolated_tests').collection(c).deleteMany({});
});
after(async () => { await closeStore(); await client?.close(); await replica?.stop(); });

test('normalizes real source facts without inventing salary, experience or verification', () => {
  const j = normalize(candidate(), source);
  assert.equal(j.category, 'Healthcare'); assert.equal(j.country, 'United Kingdom');
  assert.ok(j.description.includes('& support')); assert.ok(!j.description.includes('<p>'));
  assert.equal(j.salaryDisclosed, false); assert.equal(j.experienceDisclosed, false); assert.equal(j.trust, 'pending');
  assert.equal(publicJob(j).sourceLink, j.url); assert.equal(publicJob(j).company, j.company);
  assert.ok(!('feed' in publicJob(j))); assert.ok(!('url' in publicJob(j)));
  assert.equal(publicJob({ ...j, feed: { ...j.feed!, publicListing: false } }).sourceLink, undefined);
  assert.equal(publicJob({ ...j, feed: undefined }).identityVisible, false);
});
test('rejects unsafe URLs, stale/future dates and quarantines suspicious job content', () => {
  for (const url of ['http://careers.example.com/job', 'https://user:secret@example.com/a', 'https://127.0.0.1/job', 'https://[::1]/job', 'https://a.local/job'])
    assert.throws(() => canonicalUrl(url));
  assert.equal(canonicalUrl('https://careers.example.com/a?id=12&utm_source=test#apply'), 'https://careers.example.com/a?id=12');
  for (const postedAt of [new Date(Date.now() - 91 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString(), 'bad-date'])
    assert.throws(() => normalize(candidate({ postedAt }), source));
  assert.equal(normalize(candidate({ description: 'Please pay a registration fee before sending your application to our team.' }), source).status, 'review');
});
test('accepts all domains with an Other fallback and retains geographical restrictions', () => {
  for (const [title, expected] of [['Accountant', 'Finance'], ['School teacher', 'Education'], ['Mechanical engineer', 'Engineering'], ['Sales representative', 'Sales'], ['Unmapped specialist', 'Other']])
    assert.equal(categoryFor(candidate({ title })), expected);
  assert.equal(normalize(candidate({ location: 'Worldwide' }), source).country, 'Worldwide');
  assert.equal(normalize(candidate({ location: 'Berlin' }), source).country, 'Not specified');
});
test('approved-source gates and Remotive public attribution/cooldowns are mandatory', async () => {
  assert.equal(sourceSchema.safeParse({ ...source, approved: false }).success, false);
  assert.equal(sourceSchema.safeParse({ ...publicSources.find(s => s.type === 'remotive')!, intervalMinutes: 30 }).success, false);
  assert.equal(sourceSchema.safeParse({ ...publicSources.find(s => s.type === 'remotive')!, publicListing: false }).success, false);
  let calls = 0;
  await assert.rejects(fetchFeed({ ...source, enabled: false }, async () => { calls++; return {}; })); assert.equal(calls, 0);
});

test('GitHub organization search keeps the announcement and only publishes explicit external application links', async () => {
  const github = sourceSchema.parse({ ...source, id: 'github-example', type: 'github', board: 'example-org', company: 'Example Org', intervalMinutes: 360, maxPages: 1 });
  const result = await fetchFeed(github, async (url, headers) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://api.github.com/search/issues');
    assert.match(parsed.searchParams.get('q') || '', /org:example-org/);
    assert.equal(headers?.['Accept'], 'application/vnd.github+json');
    return { items: [
      { id: 1, number: 7, title: 'We are hiring a junior developer', html_url: 'https://github.com/example-org/jobs/issues/7',
        body: 'Our careers team is hiring. Apply at [our careers page](https://careers.example.com/jobs/7).', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' },
      { id: 2, number: 8, title: 'Hiring engineer', html_url: 'https://github.com/example-org/jobs/issues/8',
        body: 'See https://github.com/example-org/jobs for details.', created_at: '2026-09-01T00:00:00Z' },
      { id: 3, number: 9, title: 'Hiring engineer', html_url: 'https://github.com/other-org/jobs/issues/9',
        body: 'Apply at https://careers.example.com/jobs/9', created_at: '2026-09-01T00:00:00Z' },
      { id: 4, number: 10, title: 'Hiring engineer', html_url: 'https://github.com/example-org/jobs/pull/10',
        body: 'Apply at https://careers.example.com/jobs/10', pull_request: {}, created_at: '2026-09-01T00:00:00Z' },
    ] };
  });
  assert.equal(result.requests, 1); assert.equal(result.complete, false); assert.equal(result.snapshot, false);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].listingUrl, 'https://github.com/example-org/jobs/issues/7');
  assert.equal(result.jobs[0].applicationUrl, 'https://careers.example.com/jobs/7');
  const normalized = normalize(result.jobs[0], github);
  assert.equal(normalized.url, 'https://careers.example.com/jobs/7');
  assert.equal(publicJob(normalized).sourceLink, 'https://github.com/example-org/jobs/issues/7');
  assert.equal(sourceSchema.safeParse({ ...github, maxPages: 2 }).success, false);
  assert.equal(sourceSchema.safeParse({ ...github, intervalMinutes: 60 }).success, false);
});

test('GitHub application extraction rejects source, profile and unrelated links', () => {
  assert.equal(githubApplicationUrl('Hiring: visit https://github.com/example/jobs and https://example.com/about.'), undefined);
  assert.equal(githubApplicationUrl('Hiring: apply through https://jobs.lever.co/example/role.'), 'https://jobs.lever.co/example/role');
  assert.equal(githubApplicationUrl('A role is open. Submit your application at https://careers.example.com/apply.'), 'https://careers.example.com/apply');
});
test('paginated adapters never follow arbitrary next URLs and report truncation', async () => {
  const urls: string[] = [];
  const result = await fetchFeed({ ...publicSources.find(s => s.type === 'arbeitnow')!, maxPages: 2 }, async url => {
    urls.push(url); return { data: [{ slug: url, title: 'Teacher', company_name: 'School', url: 'https://www.arbeitnow.com/jobs/teacher', description: 'A complete teaching position description with requirements.', created_at: Date.now() / 1000 }], links: { next: 'http://127.0.0.1/private' } };
  }, async () => undefined);
  assert.equal(result.jobs.length, 2); assert.equal(result.complete, false);
  assert.deepEqual(urls, ['https://www.arbeitnow.com/api/job-board-api?page=1', 'https://www.arbeitnow.com/api/job-board-api?page=2']);
  assert.equal(result.jobs[0].applicationTarget, 'source-job-page');
});
test('Ashby, Greenhouse, Lever and Remotive adapters preserve supplied dates and pagination semantics', async () => {
  const ashby = await fetchFeed(source, async () => ({ jobs: [{ id: '1', title: 'Role', isListed: true, jobUrl: 'https://jobs.ashbyhq.com/example/1', applyUrl: 'https://jobs.ashbyhq.com/example/1/application', publishedAt: '2026-09-01T00:00:00Z', descriptionPlain: 'Role facts', address: { postalAddress: { addressCountry: 'USA' } } }] }));
  assert.equal(ashby.jobs[0].country, 'USA'); assert.ok(ashby.snapshot);
  assert.equal(ashby.jobs[0].applicationTarget, 'direct-form');
  const gh = await fetchFeed({ ...source, type: 'greenhouse' }, async () => ({ jobs: [{ id: 1, updated_at: '2026-09-01', title: 'Role', absolute_url: 'https://job-boards.greenhouse.io/example/jobs/1', content: 'Role facts', location: { name: 'London' } }] }));
  assert.equal(gh.jobs[0].postedAt, undefined);
  assert.equal(gh.jobs[0].applicationTarget, 'source-job-page');
  const lever = await fetchFeed({ ...source, type: 'lever' }, async () => [{ id: '1', text: 'Role', hostedUrl: 'https://jobs.lever.co/example/1', applyUrl: 'https://jobs.lever.co/example/1/apply', categories: { location: 'Remote' }, descriptionPlain: 'A complete role description supplied by the employer.' }]);
  assert.equal(lever.jobs.length, 1); assert.equal(lever.complete, true);
  const leverJob = normalize(lever.jobs[0], { ...source, type: 'lever' });
  assert.equal(leverJob.url, 'https://jobs.lever.co/example/1/apply');
  assert.equal(publicJob(leverJob).sourceLink, 'https://jobs.lever.co/example/1');
  assert.equal(publicJob(leverJob).publicApplicationLink, 'https://jobs.lever.co/example/1/apply');
  assert.equal(publicJob(leverJob).applicationTarget, 'direct-form');
  const remote = await fetchFeed(publicSources.find(s => s.type === 'remotive')!, async () => ({ jobs: [{ id: 1, title: 'Role', url: 'https://remotive.com/jobs/role', company_name: 'Employer', publication_date: '2026-09-01T10:00:00', candidate_required_location: 'Worldwide' }] }));
  assert.equal(remote.jobs[0].postedAt, '2026-09-01T10:00:00.000Z'); assert.equal(remote.snapshot, false);
  assert.equal(remote.jobs[0].applicationTarget, 'source-job-page');
});

test('additional public ATS adapters preserve employer-owned application links', async () => {
  const workable = sourceSchema.parse({ ...source, id: 'workable-example', type: 'workable', intervalMinutes: 360, maxPages: 1 });
  const workableResult = await fetchFeed(workable, async url => {
    assert.equal(url, 'https://apply.workable.com/api/v1/widget/accounts/example?details=true');
    return { jobs: [{ shortcode: 'role-1', title: 'Software Engineer', url: 'https://apply.workable.com/example/j/role-1/', description: 'Build reliable services.', location: { city: 'Pune', country: 'India' }, remote: true, created_at: '2026-09-01T00:00:00Z' }] };
  });
  assert.equal(workableResult.jobs[0].country, 'India'); assert.equal(workableResult.jobs[0].applicationTarget, 'source-job-page');

  const recruitee = sourceSchema.parse({ ...source, id: 'recruitee-example', type: 'recruitee', intervalMinutes: 360, maxPages: 1 });
  const recruiteeResult = await fetchFeed(recruitee, async url => {
    assert.equal(url, 'https://example.recruitee.com/api/offers/');
    return { offers: [{ id: 9, title: 'Graduate Engineer', careers_url: 'https://example.recruitee.com/o/graduate-engineer', description: 'Graduate role details.', city: 'Bengaluru', country: 'India', created_at: '2026-09-01T00:00:00Z' }] };
  });
  assert.equal(recruiteeResult.jobs[0].city, 'Bengaluru'); assert.equal(recruiteeResult.jobs[0].url, 'https://example.recruitee.com/o/graduate-engineer');

  const breezy = sourceSchema.parse({ ...source, id: 'breezy-example', type: 'breezy', intervalMinutes: 360, maxPages: 1 });
  const breezyResult = await fetchFeed(breezy, async url => {
    assert.equal(url, 'https://example.breezy.hr/json');
    return [{ _id: 'b1', name: 'Intern', url: 'https://example.breezy.hr/p/b1', description: 'Internship details.', location: 'Mumbai, India', remote: false }];
  });
  assert.equal(breezyResult.jobs[0].title, 'Intern');

  const rippling = sourceSchema.parse({ ...source, id: 'rippling-example', type: 'rippling', intervalMinutes: 360, maxPages: 2 });
  const ripplingResult = await fetchFeed(rippling, async url => {
    assert.equal(url, 'https://ats.rippling.com/api/v2/board/example/jobs?page=1');
    return { page: 1, totalPages: 1, jobs: [{ id: 'r1', title: 'Developer', postingUrl: 'https://ats.rippling.com/example/jobs/r1', applyUrl: 'https://ats.rippling.com/example/jobs/r1/apply', description: 'Developer role details.', location: 'Remote', remote: true }] };
  });
  assert.equal(ripplingResult.jobs[0].applicationTarget, 'direct-form'); assert.equal(ripplingResult.complete, true);
  assert.equal(sourceSchema.safeParse({ ...rippling, intervalMinutes: 60 }).success, false);
});
test('repeated syncs are idempotent, keep first discovery date and respect schedule', async () => {
  await upsertSource(source);
  const first = await runEngine(async () => batch()); assert.equal(first.results[0].counts?.added, 1);
  const j = (await read(r => r.find<Job>('jobs')))[0];
  assert.equal((await runEngine(async () => { throw Error('must not fetch'); })).results[0].status, 'not_due');
  await due(); const second = await runEngine(async () => batch()); assert.equal(second.results[0].counts?.updated, 1);
  assert.equal(await read(r => r.count('jobs')), 1);
  assert.equal((await read(r => r.get<Job>('jobs', j.id)))!.discoveredAt, j.discoveredAt);
});
test('cross-source duplicates share one job without collapsing different roles on the same board', async () => {
  await upsertSource(source); await upsertSource({ ...source, id: 'second-board' });
  await runEngine(async s => batch([candidate({ externalId: s.id, url: `https://careers.example.com/jobs/${s.id}` })]));
  assert.equal(await read(r => r.count('jobs')), 1); assert.equal(await read(r => r.count('jobFeedVariants')), 2);
});
test('failed, partial and rejected feeds do not remove listings; two complete missing snapshots close them', async () => {
  await upsertSource(source); await runEngine(async () => batch());
  await due(); await runEngine(async () => { throw new FeedError('HTTP_429', 86400000); });
  let state = await read(r => r.get<any>('jobFeedStates', source.id));
  assert.ok(state.nextRunAt > Date.now() + 86000000);
  // Simulate the provider-wide cooldown expiring inside this isolated fixture database.
  await transaction(r => r.put('jobEngineState', { id: `provider-${source.type}`, until: 0 }));
  await due(); await runEngine(async () => batch([], { complete: false }));
  assert.equal(await read(r => r.count('jobs', { status: 'published' })), 1);
  await due(); await runEngine(async () => batch([candidate({ title: '' })]));
  await due(); await runEngine(async () => batch([]));
  assert.equal(await read(r => r.count('jobs', { status: 'published' })), 1);
  await due(); await runEngine(async () => batch([]));
  assert.equal(await read(r => r.count('jobs', { status: 'closed' })), 1);
  await due(); await runEngine(async () => batch());
  assert.equal(await read(r => r.count('jobs', { status: 'published' })), 1);
});
test('manual moderation survives refresh; disabling a source withdraws its inventory', async () => {
  await upsertSource(source); await runEngine(async () => batch());
  const j = (await read(r => r.find<Job>('jobs')))[0];
  await transaction(r => r.put('jobs', { ...j, status: 'disabled' }));
  await due(); await runEngine(async () => batch()); assert.equal((await read(r => r.get<Job>('jobs', j.id)))!.status, 'disabled');
  await transaction(r => r.put('jobs', { ...j, status: 'published' }));
  await upsertSource({ ...source, enabled: false }); await runEngine(async () => { throw Error('must not fetch'); });
  assert.equal((await read(r => r.get<Job>('jobs', j.id)))!.status, 'closed');
});
test('concurrent workers cannot ingest the same cycle', async () => {
  await upsertSource(source);
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { release = r; });
  const first = runEngine(async () => { entered(); await gate; return batch(); });
  await ready;
  try { assert.equal((await runEngine(async () => batch())).status, 'busy'); } finally { release(); }
  await first; assert.equal(await read(r => r.count('jobs')), 1);
});
test('search reaches jobs beyond 1000 records and does not match unknown experience as fresher', async () => {
  const base = { ...sampleJobs()[0], sample: false, trust: 'pending' as const };
  const jobs = Array.from({ length: 1020 }, (_, i) => ({ ...base, id: `bulk-${String(i).padStart(4, '0')}`, title: i === 1019 ? 'Unique worldwide role' : 'Existing role' }));
  await client.db('job_engine_isolated_tests').collection('jobs').insertMany(jobs);
  assert.equal((await searchJobs(new URLSearchParams('q=Unique'))).total, 1);
  assert.equal((await searchJobs(new URLSearchParams('page=85'))).jobs.length, 12);
  const unknown = normalize(candidate({ title: 'Entry level nurse' }), source);
  await transaction(r => r.put('jobs', unknown));
  assert.equal((await searchJobs(new URLSearchParams('q=nurse&experience=0'))).total, 0);
  assert.equal((await searchJobs(new URLSearchParams('q=nurse'))).total, 1);
  assert.equal((await searchJobs(new URLSearchParams('page=NaN'))).page, 1);
});

test('all ISO countries and aliases are supported without inventing city/remote eligibility', () => {
  assert.equal(countryEntries.length, 250);
  for (const c of countryEntries) assert.equal(normalizeCountry(c.code), c.name);
  assert.equal(normalizeCountry('UAE'), 'United Arab Emirates');
  assert.equal(normalizeCountry('USA'), 'United States');
  for (const [name, code] of [['Antigua and Barbuda','AG'],['Hong Kong','HK'],['Cabo Verde','CV'],['Russian Federation','RU'],['Congo, The Democratic Republic of the','CD'],['Palestine, State of','PS'],['Saint Helena, Ascension and Tristan da Cunha','SH']]) assert.equal(normalizeCountry(name), normalizeCountry(code));
  assert.deepEqual(countriesInLocation('Dubai, UAE'), ['United Arab Emirates']);
  assert.deepEqual(countriesInLocation('London, United Kingdom'), ['United Kingdom']);
  assert.deepEqual(countriesInLocation('Remote - Japan'), ['Japan']);
  assert.deepEqual(countriesInLocation('Remote - Papua New Guinea'), ['Papua New Guinea']);
  assert.deepEqual(countriesInLocation('Berlin'), []);
  assert.deepEqual(countriesInLocation('EMEA'), []);
  assert.deepEqual(new Set(countriesInLocation('United States; Canada')), new Set(['United States', 'Canada']));
});

test('Jobicy keeps attribution, geography and salary period; snapshots are never inferred', async () => {
  const s = publicSources.find(s => s.type === 'jobicy')!;
  assert.equal(sourceSchema.safeParse({ ...s, intervalMinutes: 30 }).success, false);
  const b = await fetchFeed(s, async url => {
    assert.equal(url, 'https://jobicy.com/api/v2/remote-jobs?count=200');
    return { jobs: [{ id: 1, jobTitle: 'Marine biologist', companyName: 'Lab', url: 'https://jobicy.com/jobs/1',
      jobDescription: 'Marine biodiversity research with laboratory and field teams.', jobGeo: 'Australia', jobType: ['part-time'],
      jobIndustry: ['Science'], pubDate: new Date().toISOString(), salaryMin: 25, salaryMax: 35, salaryCurrency: 'AUD', salaryPeriod: 'hourly' }] };
  });
  const j = normalize(b.jobs[0], s);
  assert.equal(j.country, 'Australia'); assert.equal(j.mode, 'Remote'); assert.equal(j.type, 'part-time');
  assert.equal(j.salaryText, 'AUD 25–35 hourly'); assert.equal(b.snapshot, false);
  assert.equal(publicJob(j).sourceLink, 'https://jobicy.com/jobs/1');
  assert.throws(() => normalize({ ...b.jobs[0], url: 'https://other.example.com/job', listingUrl: 'https://other.example.com/job', applicationUrl: 'https://other.example.com/job' }, s));
});

test('The Muse requires its registered key and retains the required source job-page link', async () => {
  const oldKey = process.env.THEMUSE_API_KEY;
  delete process.env.THEMUSE_API_KEY;
  const muse = { ...source, type: 'themuse' as const, id: 'themuse-test', name: 'The Muse', intervalMinutes: 360, maxPages: 2 };
  try {
    let calls = 0;
    await assert.rejects(fetchFeed(muse, async () => { calls++; return {}; }), /MISSING_THEMUSE_CREDENTIALS/);
    assert.equal(calls, 0);
    process.env.THEMUSE_API_KEY = 'fixture-key';
    const batch = await fetchFeed(muse, async raw => {
      const url = new URL(raw);
      assert.equal(url.origin, 'https://www.themuse.com');
      assert.equal(url.pathname, '/api/public/jobs');
      assert.equal(url.searchParams.get('api_key'), 'fixture-key');
      return { page_count: 1, results: [{ id: 7, name: 'Graduate software engineer', contents: 'Build accessible products with an experienced engineering team.',
        publication_date: '2026-10-12T00:00:00Z', company: { name: 'Example India' }, locations: [{ name: 'Bengaluru, India' }],
        categories: [{ name: 'Engineering' }], levels: [{ name: 'Entry Level' }], refs: { landing_page: 'https://www.themuse.com/jobs/example/graduate-software-engineer' } }] };
    });
    assert.equal(batch.complete, true); assert.equal(batch.jobs.length, 1);
    const job = normalize(batch.jobs[0], muse);
    assert.equal(job.url, 'https://www.themuse.com/jobs/example/graduate-software-engineer');
    assert.equal(publicJob(job).applicationTarget, 'source-job-page');
    assert.equal(job.country, 'India');
  } finally {
    if (oldKey === undefined) delete process.env.THEMUSE_API_KEY; else process.env.THEMUSE_API_KEY = oldKey;
  }
});

test('Freehire connector requires a licensed key and preserves attribution plus original application links', async () => {
  const oldKey = process.env.FREEHIRE_API_KEY;
  const freehire = sourceSchema.parse({ ...source, id: 'freehire-test', type: 'freehire', name: 'freehire', board: undefined, company: undefined,
    intervalMinutes: 360, maxPages: 1, policyEvidence: 'Licensed API plan fixture with visible attribution: https://freehire.me/docs/api', publicListing: true });
  try {
    delete process.env.FREEHIRE_API_KEY;
    let calls = 0;
    await assert.rejects(fetchFeed(freehire, async () => { calls++; return {}; }), /MISSING_FREEHIRE_CREDENTIALS/);
    assert.equal(calls, 0);
    process.env.FREEHIRE_API_KEY = 'fixture-key';
    const batch = await fetchFeed(freehire, async (raw, headers) => {
      const url = new URL(raw);
      assert.equal(url.origin, 'https://freehire.me'); assert.equal(url.pathname, '/api/v1/agent/jobs/search');
      assert.equal(url.searchParams.get('limit'), '100'); assert.equal(headers?.Authorization, 'Bearer fixture-key');
      return { data: [{ public_slug: 'graduate-software-engineer-example-1', title: 'Graduate Software Engineer', company: 'Example India',
        url: 'https://jobs.example.com/roles/graduate-engineer', description: 'Build reliable products with a supportive team.',
        location: 'Bengaluru, India', countries: ['in'], skills: ['typescript', 'node.js'], work_mode: 'hybrid',
        posted_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
        enrichment: { category: 'software_engineering', employment_type: 'internship', salary_min: 600000, salary_max: 900000, salary_currency: 'INR', salary_period: 'year' } }],
        meta: { total: 1, limit: 100, offset: 0 } };
    });
    assert.equal(batch.complete, true); assert.equal(batch.jobs.length, 1);
    const job = normalize(batch.jobs[0], freehire);
    assert.equal(publicJob(job).sourceLink, 'https://freehire.me/jobs/graduate-software-engineer-example-1');
    assert.equal(publicJob(job).publicApplicationLink, 'https://jobs.example.com/roles/graduate-engineer');
    assert.equal(publicJob(job).applicationTarget, 'direct-form');
    assert.equal(job.country, 'India');
  } finally {
    if (oldKey === undefined) delete process.env.FREEHIRE_API_KEY; else process.env.FREEHIRE_API_KEY = oldKey;
  }
});

test('Hacker News hiring discovery is approval-gated and accepts only clear announcements with external apply links', async () => {
  const prior = process.env.HACKERNEWS_JOB_DISCOVERY_APPROVAL_REFERENCE;
  const hackernews = sourceSchema.parse({ ...source, id: 'hn-hiring-test', type: 'hackernews', name: 'Hacker News Who is hiring?', board: undefined, company: undefined,
    intervalMinutes: 1440, maxPages: 1, publicListing: true, policyEvidence: 'Official HN API with platform approval fixture: https://github.com/HackerNews/API' });
  try {
    delete process.env.HACKERNEWS_JOB_DISCOVERY_APPROVAL_REFERENCE;
    let calls = 0;
    await assert.rejects(fetchFeed(hackernews, async () => { calls++; return []; }), /MISSING_HACKERNEWS_WRITTEN_APPROVAL/);
    assert.equal(calls, 0);
    process.env.HACKERNEWS_JOB_DISCOVERY_APPROVAL_REFERENCE = 'HN legal review fixture 001';
    const batch = await fetchFeed(hackernews, async raw => {
      const url = new URL(raw);
      if (url.pathname.endsWith('/askstories.json')) return [100];
      if (url.pathname.endsWith('/item/100.json')) return { id: 100, title: 'Ask HN: Who is hiring? (October 2026)', kids: [101, 102] };
      if (url.pathname.endsWith('/item/101.json')) return { id: 101, type: 'comment', time: 1790800000,
        text: 'Example Labs | Pune, India | Remote | Graduate Software Engineer<br>Apply: https://careers.example.com/jobs/graduate-engineer' };
      return { id: 102, type: 'comment', time: 1790800000, text: 'Example Labs | Remote | Roles | Email us for details' };
    });
    assert.equal(batch.jobs.length, 1); assert.equal(batch.snapshot, false);
    const job = normalize(batch.jobs[0], hackernews);
    assert.equal(job.company, 'Example Labs'); assert.equal(job.country, 'India');
    assert.equal(publicJob(job).sourceLink, 'https://news.ycombinator.com/item?id=100');
    assert.equal(publicJob(job).publicApplicationLink, 'https://careers.example.com/jobs/graduate-engineer');
    assert.equal(sourceSchema.safeParse({ ...hackernews, maxPages: 2 }).success, false);
  } finally {
    if (prior === undefined) delete process.env.HACKERNEWS_JOB_DISCOVERY_APPROVAL_REFERENCE; else process.env.HACKERNEWS_JOB_DISCOVERY_APPROVAL_REFERENCE = prior;
  }
});

test('GitHub hiring discovery is approval-gated and accepts only attributed employer posts with an external apply link', async () => {
  const oldApproval = process.env.GITHUB_JOB_DISCOVERY_APPROVAL_REFERENCE;
  const oldToken = process.env.GITHUB_JOB_DISCOVERY_TOKEN;
  delete process.env.GITHUB_JOB_DISCOVERY_APPROVAL_REFERENCE;
  delete process.env.GITHUB_JOB_DISCOVERY_TOKEN;
  const github = sourceSchema.parse({ ...source, id: 'github-approved-test', type: 'github-authorized', name: 'Approved GitHub employer feed',
    company: 'Example Employer', repository: 'example-org/hiring', publicListing: true, intervalMinutes: 360, maxPages: 1,
    policyEvidence: 'GitHub written approval and employer authorization fixture reference: https://github.com/example-org/hiring',
  });
  try {
    let calls = 0;
    await assert.rejects(fetchFeed(github, async () => { calls++; return []; }), /MISSING_GITHUB_WRITTEN_APPROVAL/);
    assert.equal(calls, 0);
    process.env.GITHUB_JOB_DISCOVERY_APPROVAL_REFERENCE = 'GitHub case GH-TEST-001';
    process.env.GITHUB_JOB_DISCOVERY_TOKEN = 'fixture-token';
    const batch = await fetchFeed(github, async (raw, headers) => {
      const url = new URL(raw);
      assert.equal(url.origin, 'https://api.github.com'); assert.equal(url.pathname, '/repos/example-org/hiring/issues');
      assert.equal(url.searchParams.get('state'), 'open'); assert.equal(headers?.Authorization, 'Bearer fixture-token');
      return [
        { id: 1, title: 'Hiring: Graduate Software Engineer', body: 'Location: Pune, India\nApply here: https://careers.example.com/jobs/graduate-engineer/apply',
          html_url: 'https://github.com/example-org/hiring/issues/1', author_association: 'MEMBER', created_at: '2026-10-12T08:00:00Z', updated_at: '2026-10-12T09:00:00Z' },
        { id: 2, title: 'Hiring', body: 'Email us for details', html_url: 'https://github.com/example-org/hiring/issues/2', author_association: 'MEMBER' },
        { id: 3, title: 'Hiring: Backend Engineer', body: 'Apply: https://careers.example.com/jobs/backend', html_url: 'https://github.com/example-org/hiring/issues/3', author_association: 'NONE' },
        { id: 4, title: 'Hiring: Platform Engineer', body: 'Apply: https://careers.example.com/jobs/platform', html_url: 'https://github.com/example-org/hiring/pull/4', author_association: 'OWNER', pull_request: {} },
      ];
    });
    assert.equal(batch.complete, true); assert.equal(batch.snapshot, true); assert.equal(batch.jobs.length, 1);
    assert.equal(batch.jobs[0].title, 'Graduate Software Engineer');
    assert.equal(batch.jobs[0].url, 'https://github.com/example-org/hiring/issues/1');
    assert.equal(batch.jobs[0].applicationUrl, 'https://careers.example.com/jobs/graduate-engineer/apply');
    assert.equal(batch.jobs[0].applicationTarget, 'source-redirect');
    assert.equal(sourceSchema.safeParse({ ...github, maxPages: 2 }).success, false);
  } finally {
    if (oldApproval === undefined) delete process.env.GITHUB_JOB_DISCOVERY_APPROVAL_REFERENCE; else process.env.GITHUB_JOB_DISCOVERY_APPROVAL_REFERENCE = oldApproval;
    if (oldToken === undefined) delete process.env.GITHUB_JOB_DISCOVERY_TOKEN; else process.env.GITHUB_JOB_DISCOVERY_TOKEN = oldToken;
  }
});

test('gated providers fail before network without credentials; invalid Adzuna countries fail validation', async () => {
  const old = process.env.ADZUNA_APP_KEY, oldUs = process.env.USAJOBS_API_KEY;
  delete process.env.ADZUNA_APP_KEY; delete process.env.USAJOBS_API_KEY;
  try {
    let calls = 0;
    for (const type of ['adzuna', 'usajobs'] as const)
      await assert.rejects(fetchFeed({ ...source, type, countryCode: 'in' }, async () => { calls++; return {}; }), /MISSING_.*_CREDENTIALS/);
    assert.equal(calls, 0);
    assert.equal(sourceSchema.safeParse({ ...source, type: 'adzuna', countryCode: 'ae' }).success, false);
  } finally { if (old !== undefined) process.env.ADZUNA_APP_KEY = old; if (oldUs !== undefined) process.env.USAJOBS_API_KEY = oldUs; }
});

test('Adzuna uses country endpoint, preserves source link and omits predicted salaries', async () => {
  const oldId = process.env.ADZUNA_APP_ID, oldKey = process.env.ADZUNA_APP_KEY;
  process.env.ADZUNA_APP_ID = 'fixture-id'; process.env.ADZUNA_APP_KEY = 'fixture-key';
  try {
    const s = { ...source, type: 'adzuna' as const, countryCode: 'in', maxPages: 1 };
    const b = await fetchFeed(s, async raw => {
      const url = new URL(raw); assert.equal(url.pathname, '/v1/api/jobs/in/search/1'); assert.equal(url.searchParams.get('sort_by'), 'date');
      return { count: 1, results: [{ id: 'a1', title: 'Agronomist', company: { display_name: 'Farm' }, location: { display_name: 'Pune, India', area: ['India'] }, category: { label: 'Agriculture' }, description: 'Support crop planning and sustainable agriculture research.', redirect_url: 'https://www.adzuna.in/jobs/land/ad/1?utm_source=publisher', created: new Date().toISOString(), salary_min: 9999, salary_is_predicted: 1, contract_time: 'full_time' }] };
    });
    const j = normalize(b.jobs[0], s); assert.equal(j.country, 'India'); assert.equal(j.salaryDisclosed, false);
    assert.ok(j.url?.includes('utm_source=publisher')); assert.equal(b.snapshot, false);
  } finally { if (oldId === undefined) delete process.env.ADZUNA_APP_ID; else process.env.ADZUNA_APP_ID = oldId; if (oldKey === undefined) delete process.env.ADZUNA_APP_KEY; else process.env.ADZUNA_APP_KEY = oldKey; }
});

test('USAJOBS preserves overseas locations, eligibility text and closing date', async () => {
  const oldKey = process.env.USAJOBS_API_KEY, oldUa = process.env.USAJOBS_USER_AGENT;
  process.env.USAJOBS_API_KEY = 'fixture-key'; process.env.USAJOBS_USER_AGENT = 'fixture@example.invalid';
  try {
    const closesAt = new Date(Date.now() + 3600000).toISOString();
    const b = await fetchFeed({ ...source, type: 'usajobs' }, async (_url, headers) => {
      assert.equal(headers?.['Authorization-Key'], 'fixture-key');
      return { SearchResult: { SearchResultCountAll: 1, SearchResultItems: [{ MatchedObjectId: 1, MatchedObjectDescriptor: {
        PositionTitle: 'Librarian', OrganizationName: 'Agency', PositionURI: 'https://www.usajobs.gov/job/1', ApplyURI: ['https://www.usajobs.gov/job/1/apply'], PositionLocationDisplay: 'Tokyo, Japan', PositionLocation: [{ CountryCode: 'Japan' }], PublicationStartDate: new Date().toISOString(), ApplicationCloseDate: closesAt,
        UserArea: { Details: { JobSummary: 'Manage a research library and its information services.', WhoMayApply: { Name: 'United States Citizens' } } }, PositionSchedule: [{ Name: 'Full Time' }], JobCategory: [{ Name: 'Library Science' }] } }] } };
    });
    const j = normalize(b.jobs[0], { ...source, type: 'usajobs' });
    assert.equal(j.country, 'Japan'); assert.equal(j.expiresAt, closesAt); assert.ok(j.description.includes('United States Citizens'));
    assert.equal(j.url, 'https://www.usajobs.gov/job/1/apply');
    assert.equal(publicJob(j).sourceLink, 'https://www.usajobs.gov/job/1');
    assert.equal(publicJob(j).applicationTarget, 'direct-form');
    assert.throws(() => normalize({ ...b.jobs[0], closesAt: '2000-01-01' }, source));
  } finally { if (oldKey === undefined) delete process.env.USAJOBS_API_KEY; else process.env.USAJOBS_API_KEY = oldKey; if (oldUa === undefined) delete process.env.USAJOBS_USER_AGENT; else process.env.USAJOBS_USER_AGENT = oldUa; }
});

test('search covers unmatched professions, job types and multiple countries; report exposes zero coverage', async () => {
  const j = normalize(candidate({ title: 'Research specialist', description: 'Marine biodiversity surveys and fisheries research. Work with scientific teams.', location: 'United Arab Emirates; India', employmentType: 'part_time', category: 'Ocean science' }), source);
  await transaction(r => r.put('jobs', j));
  assert.equal((await searchJobs(new URLSearchParams('q=biodiversity&country=UAE&type=part-time'))).total, 1);
  assert.equal((await searchJobs(new URLSearchParams('country=India'))).total, 1);
  assert.equal((await searchJobs(new URLSearchParams('country=Japan'))).total, 0);
  assert.equal((await searchJobs(new URLSearchParams('q=Ocean'))).total, 1);
  const coverage = await coverageReport();
  assert.equal(coverage.countries.length, 250); assert.equal(coverage.total, 1);
  assert.equal(coverage.countries.find(c => c.code === 'AE')?.indexedListings, 1);
  assert.equal(coverage.countries.find(c => c.code === 'JP')?.status, 'no_explicit_inventory');
});

test('coverage measures India-local jobs separately from India-eligible remote jobs', async () => {
  const local = normalize(candidate({ externalId: 'india-local', title: 'Software engineer', company: 'India employer',
    location: 'Pune, Maharashtra, India', country: 'India', city: 'Pune', state: 'Maharashtra', category: 'Information technology' }), source);
  const eligible = normalize(candidate({ externalId: 'india-eligible', title: 'Remote analyst', company: 'Global employer',
    url: 'https://careers.example.com/jobs/india-eligible', location: 'Remote', countryCodes: ['IN', 'AE'], category: 'Data and analytics' }), source);
  await transaction(async r => {
    await r.putMany('jobs', [local, eligible]);
    await r.put('jobSources', {
      id: 'india-direct-source', name: 'India employer careers', provider: 'lever', enabled: true,
      compliance: { status: 'approved', jurisdictions: ['India'] }, schedule: { intervalMinutes: 60 },
      health: { status: 'idle', consecutiveFailures: 0, lastSuccessAt: new Date().toISOString() },
    });
    await r.put('jobFeedSources', { ...source, id: 'india-engine-source', countryCode: 'in' });
    await r.put('jobFeedStates', { id: 'india-engine-source', status: 'completed', failures: 0, lastSuccessAt: new Date().toISOString(), nextRunAt: Date.now() + 3600000 });
    await r.put('jobFeedSources', { ...source, id: 'failed-engine-source', countryCode: 'in' });
    await r.put('jobFeedStates', { id: 'failed-engine-source', status: 'failed', errorCode: 'MISSING_PARTNER_CREDENTIALS', failures: 1, nextRunAt: Date.now() + 3600000 });
  });

  const report = await coverageReport();
  assert.equal(report.india.localListings, 1);
  assert.equal(report.india.eligibleListings, 2);
  assert.equal(report.india.remoteOrInternationalEligible, 1);
  assert.equal(report.india.localWithoutState, 0);
  assert.equal(report.india.locationQuality.stateCompletenessPercent, 100);
  assert.equal(report.india.locationQuality.cityCompletenessPercent, 100);
  assert.equal(report.india.locationQuality.statesRepresented, 1);
  assert.equal(report.india.locationQuality.officialRegionsCovered, 1);
  assert.equal(report.india.locationQuality.officialRegionsTotal, 36);
  assert.equal(report.india.locationQuality.officialRegionCoveragePercent, 2.8);
  assert.ok(report.india.locationQuality.unrepresentedRegions.includes('Delhi'));
  assert.equal(report.india.sourceHealth.indiaScoped, 1);
  assert.equal(report.india.sourceHealth.reportingNormally, 1);
  assert.equal(report.india.sourceHealth.engine.indiaScoped, 2);
  assert.equal(report.india.sourceHealth.engine.reportingNormally, 1);
  assert.equal(report.india.sourceHealth.engine.failed, 1);
  assert.deepEqual(report.india.sourceHealth.engine.failureCodes, [{ name: 'MISSING_PARTNER_CREDENTIALS', listings: 1 }]);
  assert.equal(report.india.sourceHealth.engine.staleOrNeverRun, 1);
  assert.equal(report.india.states.find(item => item.name === 'Maharashtra')?.listings, 1);
  assert.equal(report.india.cities.find(item => item.name === 'Pune')?.listings, 1);
  assert.equal(report.india.sources.find(item => item.name === source.id)?.listings, 2);
  assert.equal(report.india.freshness.seenLast24Hours, 2);
});

test('country rollout covers every directory entry and queries explicit eligibility, not worldwide substitutes', async () => {
  assert.equal(new Set(worldwideSources.filter(s => s.countryCode).map(s => s.countryCode)).size, countryEntries.length);
  for (const s of worldwideSources) assert.ok(sourceSchema.safeParse(s).success);
  const s = worldwideSources.find(s => s.countryCode === 'in')!;
  const b = await fetchFeed(s, async url => {
    const q = new URL(url).searchParams; assert.equal(q.get('country'), 'IN'); assert.equal(q.get('exclude_worldwide'), 'true');
    return { jobs: [{ guid: 'india-role', title: 'Agriculture analyst', companyName: 'Research firm',
      applicationLink: 'https://careers.example.com/india-role', description: 'Research agricultural markets and work with local teams.',
      locationRestrictions: [{ alpha2: 'IN', name: 'India' }, { alpha2: 'AE', name: 'United Arab Emirates' }],
      timezoneRestrictions: ['UTC+5:30'], pubDate: Date.now(), expiryDate: Date.now() + 86400000,
      employmentType: 'Full Time', categories: ['Agriculture'] }], totalCount: 100, limit: 20 };
  }, async () => undefined);
  const j = normalize(b.jobs[0], s);
  assert.equal(b.complete, false); assert.equal(b.snapshot, false);
  assert.deepEqual(new Set(j.eligibleCountries), new Set(['India', 'United Arab Emirates']));
  assert.ok(j.description.includes('UTC+5:30'));
  assert.equal(publicJob(j).sourceLink, 'https://himalayas.app');
  assert.equal(publicJob(j).publicApplicationLink, 'https://careers.example.com/india-role');
  assert.equal(publicJob(j).applicationTarget, 'direct-form');
});

test('missing Himalayas geography is never treated as worldwide and empty feed is a valid result', async () => {
  const s = worldwideSources.find(s => s.countryCode === 'ae')!;
  const result = await fetchFeed(s, async () => ({ jobs: [], totalCount: 0, limit: 20 }), async () => undefined);
  assert.equal(result.complete, true); assert.equal(result.jobs.length, 0);
  const b = await fetchFeed(s, async () => ({ jobs: [{guid:'unknown',title:'Role',companyName:'Employer',applicationLink:'https://careers.example.com/unknown',description:'Work with our research and operations teams.',pubDate:Math.floor(Date.now()/1000),expiryDate:Math.floor(Date.now()/1000)+86400}], totalCount:1,limit:20 }), async () => undefined);
  assert.equal(normalize(b.jobs[0],s).country,'Not specified');
  assert.ok(Date.parse(b.jobs[0].postedAt!) > Date.now()-10000);
});

test('a provider 429 prevents later country sources from making network calls', async () => {
  const india = worldwideSources.find(s => s.countryCode === 'in')!, uae = worldwideSources.find(s => s.countryCode === 'ae')!;
  await upsertSource(india); await upsertSource(uae);
  let calls = 0;
  const result = await runEngine(async () => { calls++; throw new FeedError('HTTP_429', 7200000); });
  assert.equal(calls, 1); assert.equal(result.results[1].status, 'provider_backoff');
  assert.ok((await read(r=>r.get<{until:number}>('jobEngineState','provider-himalayas')))!.until >= Date.now()+7100000);
});

test('Remote OK skips feed metadata and preserves its original posting link', async () => {
  const s = worldwideSources.find(s => s.type === 'remoteok')!;
  const b = await fetchFeed(s, async () => [{ legal: 'Credit source' }, { id: 9, position: 'Nurse', company: 'Clinic', date: new Date().toISOString(), location: 'India', url: 'https://remoteok.com/remote-jobs/9', description: 'Provide remote clinical triage and patient support.' }]);
  assert.equal(b.jobs.length, 1); assert.equal(b.snapshot, false);
  assert.equal(publicJob(normalize(b.jobs[0], s)).sourceLink, 'https://remoteok.com/remote-jobs/9');
});

test('equivalent persisted policy property order does not reject a country import', async () => {
  const s = worldwideSources.find(s => s.countryCode === 'in')!;
  await transaction(r => r.put('jobFeedSources', s));
  const result = await runEngine(async () => batch([candidate({ country: 'India' })]));
  assert.equal(result.results[0].counts?.added, 1);
  assert.equal(await read(r => r.count('jobs')), 1);
});


test('JobSearch paginates, preserves occupations, maps only explicit Sweden and excludes removed ads', async () => {
  const config = sourceSchema.parse({ ...source, type: 'jobtech', intervalMinutes: 360 });
  let calls = 0;
  const result = await fetchFeed(config, async url => {
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://jobsearch.api.jobtechdev.se');
    assert.equal(parsed.searchParams.get('sort'), 'pubdate-desc');
    assert.equal(parsed.searchParams.get('offset'), String(calls++ * 100));
    const ad = { id: 'a', headline: 'Lärare', employer: { name: 'School' }, webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/a', application_details: { url: 'https://school.example.com/jobs/a/apply', email: 'careers@school.example.com' },
      description: { text: 'Teaching children in a supportive school environment.' }, workplace_address: { country: 'Sverige', municipality: 'Stockholm' },
      working_hours_type: { label: 'Heltid' }, occupation: { label: 'Lärare' }, publication_date: '2026-09-11T09:00:00', application_deadline: '2026-12-31T23:59:59' };
    return { total: { value: 101 }, hits: calls === 1 ? Array.from({ length: 100 }, () => ad) : [{ ...ad, removed: true }] };
  }, async () => undefined);
  assert.equal(calls, 2); assert.equal(result.jobs.length, 100); assert.equal(result.complete, true); assert.equal(result.snapshot, false);
  assert.equal(result.jobs[0].country, 'Sweden'); assert.equal(result.jobs[0].employmentType, 'Full-time');
  assert.equal(result.jobs[0].postedAt, undefined); assert.equal(result.jobs[0].closesAt, '2026-12-31T00:00:00.000Z');
  assert.equal(result.jobs[0].listingUrl, 'https://arbetsformedlingen.se/platsbanken/annonser/a');
  assert.equal(result.jobs[0].applicationUrl, 'https://school.example.com/jobs/a/apply');
  assert.equal(result.jobs[0].applicationEmail, 'careers@school.example.com');
  assert.equal(result.jobs[0].applicationTarget, 'direct-form');
  assert.equal(normalize(result.jobs[0], config).method, 'external', 'the direct application form takes precedence over email');
  assert.deepEqual(result.jobs[0].tags, ['Lärare']);
  const partial = await fetchFeed({ ...config, maxPages: 1 }, async () => ({ hits: Array(100).fill({}), total: { value: 900 } }));
  assert.equal(partial.complete, false);
});

test('Reed requires private access and safely handles bounded search results and errors', async () => {
  const old = process.env.REED_API_KEY; const config = sourceSchema.parse({ ...source, type: 'reed', intervalMinutes: 360 });
  try {
    delete process.env.REED_API_KEY;
    await assert.rejects(fetchFeed(config, async () => { throw Error('Must not call'); }), /MISSING_REED_CREDENTIALS/);
    process.env.REED_API_KEY = 'fixture-secret';
    const result = await fetchFeed(config, async (url, headers) => {
      assert.equal(new URL(url).hostname, 'www.reed.co.uk');
      assert.equal(headers?.Authorization, 'Basic ' + Buffer.from('fixture-secret:').toString('base64'));
      return { results: [{ jobId: 42, jobTitle: 'Nurse', employerName: 'Hospital', jobDescription: 'Provide excellent care to patients and their families.', locationName: 'London', jobUrl: 'https://www.reed.co.uk/jobs/nurse/42' }], totalResults: 1 };
    });
    assert.equal(result.jobs[0].country, undefined); assert.equal(result.jobs[0].postedAt, undefined); assert.equal(result.snapshot, false);
    await assert.rejects(fetchFeed(config, async () => { throw Error('fixture-secret'); }), { message: 'REED_REQUEST_FAILED' });
    await assert.rejects(fetchFeed(config, async () => ({})), /INVALID_FEED/);
  } finally { if (old === undefined) delete process.env.REED_API_KEY; else process.env.REED_API_KEY = old; }
});


test('multilingual occupations retain original facts and unmatched roles remain searchable', () => {
  const examples = [['Sjuksköterska', 'Healthcare'], ['Enseignant', 'Education'], ['مهندس', 'Engineering'], ['नर्स', 'Healthcare'], ['Desarrollador', 'Technology'], ['Lantbrukare', 'Agriculture'], ['Montör', 'Manufacturing'], ['Plumber', 'Skilled trades']];
  for (const [title, category] of examples) {
    const job = normalize(candidate({ title }), source);
    assert.equal(job.title, title); assert.equal(job.category, category);
  }
  const unknown = normalize(candidate({ title: 'Specialist role XYZ', employmentType: 'Unusual seasonal arrangement' }), source);
  assert.equal(unknown.category, 'Other'); assert.equal(unknown.type, 'Unusual seasonal arrangement');
});

test('coverage audit is persisted with actual inventory rather than country filter totals', async () => {
  await transaction(r => r.put('jobs', normalize(candidate(), source)));
  const report = await saveCoverageAudit();
  const saved = await read(r => r.get('jobEngineState', 'coverage-latest'));
  assert.equal(saved?.total, report.total); assert.equal(report.total, 1);
  assert.equal(report.countries.find(c => c.name === 'India')?.indexedListings, 0);
});


test('SmartRecruiters only retrieves public active postings from a fixed company endpoint', async () => {
  const config = sourceSchema.parse({ ...source, type: 'smartrecruiters', intervalMinutes: 360 });
  const urls: string[] = [];
  const result = await fetchFeed(config, async url => {
    urls.push(url);
    if (url.includes('?')) return { totalFound: 2, content: [{ id: 'one', ref: 'https://evil.invalid/private' }, { id: 'two' }] };
    return { active: url.endsWith('/one'), name: 'Teacher', postingUrl: 'https://jobs.smartrecruiters.com/example/one', applyUrl: 'https://jobs.smartrecruiters.com/example/one?oga=true', jobAd: { sections: { jobDescription: { text: 'Teach and support students in a welcoming classroom.' } } }, location: { country: 'in' } };
  }, async () => undefined);
  assert.equal(result.jobs.length, 1); assert.equal(result.requests, 3); assert.equal(result.complete, true);
  assert.equal(result.jobs[0].applicationTarget, 'direct-form');
  assert.ok(urls.every(url => url.startsWith('https://api.smartrecruiters.com/v1/companies/example/postings')));
  await assert.rejects(fetchFeed(config, async () => ({ content: [{ id: '../private' }] })), /INVALID_POSTING_ID/);
  assert.equal(sourceSchema.safeParse({ ...config, board: undefined }).success, false);
});

test('normalized facts preserve unknowns, source updates, salary units and separate skill evidence', () => {
  const now = Date.now();
  const job = normalize(candidate({ city: 'London', state: 'England', tags: ['Healthcare'], skills: ['Patient care'],
    updatedAt: new Date(now - 1000).toISOString(), salary: { min: 25000, max: 40000, currency: 'GBP', period: 'annual' },
    experience: { min: 0, max: 2, text: '0 to 2 years' } }), source, now);
  assert.equal(job.city, 'London'); assert.equal(job.state, 'England');
  assert.deepEqual(job.skills, ['Patient care']); assert.deepEqual(job.normalizedFacts?.sourceTags, ['Healthcare']);
  assert.equal(job.salaryDisclosed, true); assert.equal(job.currency, 'GBP');
  assert.equal(job.normalizedFacts?.salary.period, 'annual'); assert.equal(job.experienceDisclosed, true);
  assert.equal(job.normalizedFacts?.expiresAt, null); assert.ok(job.sourceUpdatedAt);
  assert.equal(publicJob(job).sourceJobId, 'role-1');
  const unknown = normalize(candidate({ updatedAt: new Date(now + 86400000).toISOString(), salary: { min: 100, max: 1, currency: 'USD' } }), source, now);
  assert.equal(unknown.normalizedFacts?.salary.min, null); assert.equal(unknown.salaryDisclosed, false);
  assert.equal(unknown.normalizedFacts?.city, null); assert.equal(unknown.sourceUpdatedAt, undefined);
  assert.equal(unknown.trust, 'pending');
});


test('fast employer cadence preserves failure cooldowns and rejects restricted sources', async () => {
  assert.equal(sourceSchema.safeParse({ ...source, intervalMinutes: 5 }).success, true);
  assert.equal(sourceSchema.safeParse({ ...source, intervalMinutes: 4 }).success, false);
  for (const type of ['jooble','himalayas','remotive','usajobs','arbeitnow','smartrecruiters'])
    assert.equal(sourceSchema.safeParse({ ...source, type, intervalMinutes: 10 }).success, false);
  await upsertSource(source);
  await runEngine(async () => batch());
  await setEmployerRefresh(source.id, 10);
  let state = await read(r => r.get<any>('jobFeedStates', source.id));
  assert.equal(state.nextRunAt, Date.parse(state.lastSuccessAt) + 600000);
  let calls = 0;
  await runEngine(async () => { calls++; return batch(); });
  assert.equal(calls, 0);
  const cooldown = Date.now() + 7200000;
  await transaction(r => r.put('jobFeedStates', { ...state, status: 'failed', failures: 1, nextRunAt: cooldown }));
  await setEmployerRefresh(source.id, 5);
  state = await read(r => r.get<any>('jobFeedStates', source.id));
  assert.equal(state.nextRunAt, cooldown);
  await transaction(r => r.put('jobFeedStates', { ...state, status: 'completed', failures: 0, nextRunAt: Date.now() - 1 }));
  await runEngine(async () => { calls++; return batch([candidate(), candidate({ externalId: 'new-role', url: 'https://careers.example.com/jobs/new-role', title: 'New nursing position' })]); });
  assert.equal(calls, 1);
  assert.equal(await read(r => r.count('jobs', { status: 'published' })), 2);
});

test('structured filters combine skills, city, trust and compatible salary without exposing gated companies', async () => {
  const base = normalize(candidate({city:'London',skills:['Patient care','First aid'],salary:{min:30000,max:45000,currency:'GBP',period:'annual'}}),source);
  await transaction(r => r.putMany('jobs', [
    {...base,id:'filter-good',trust:'verified',mnc:true},
    {...base,id:'filter-currency',currency:'USD',normalizedFacts:{...base.normalizedFacts!,salary:{...base.normalizedFacts!.salary,currency:'USD'}}},
    {...base,id:'filter-unknown',salaryDisclosed:false},
    {...base,id:'filter-hidden',company:'Secret Employer',feed:undefined},
  ]));
  const result = await searchJobs(new URLSearchParams('city=london&skills=Patient%20care,First%20aid&salaryMin=35000&currency=GBP&salaryPeriod=annual&trust=verified&mnc=true'));
  assert.deepEqual(result.jobs.map(j=>j.id),['filter-good']);
  assert.equal((await searchJobs(new URLSearchParams('company=Secret%20Employer'))).total,0);
  assert.equal((await searchJobs(new URLSearchParams('salaryMin=35000'))).total,0);
  assert.equal((await searchJobs(new URLSearchParams('salaryMin=50000&salaryMax=1&currency=GBP&salaryPeriod=annual'))).total,0);
  assert.equal((await searchJobs(new URLSearchParams('skills=Patient%20care,Unknown'))).total,0);
  const report = await coverageReport();
  assert.equal(report.completeness.normalized,4); assert.equal(report.completeness.verified,1);
});

test('job search supports freshness, entry-level, internship, direct-form and transparent relevance filters', async () => {
  const now = Date.now();
  const graduate = normalize(candidate({ externalId: 'graduate-intern', title: 'React Graduate Intern', company: 'India Product Company',
    description: 'Build accessible React product features with an experienced engineering team.', location: 'Pune, India',
    skills: ['React', 'TypeScript'], employmentType: 'Internship', postedAt: new Date(now - 2 * 3600000).toISOString(),
    url: 'https://careers.example.com/jobs/graduate-intern',
    applicationUrl: 'https://careers.example.com/jobs/graduate-intern/apply', applicationTarget: 'direct-form',
  }), source, now);
  const older = normalize(candidate({ externalId: 'older-role', title: 'Platform Engineer', company: 'India Product Company',
    description: 'React platform work for production engineering systems and services.', location: 'Pune, India',
    url: 'https://careers.example.com/jobs/older-role',
    postedAt: new Date(now - 8 * 86400000).toISOString(),
  }), source, now);
  const unknownDate = normalize(candidate({ externalId: 'unknown-date-role', title: 'Software Trainee', company: 'India Product Company',
    description: 'A structured entry-level programme for software engineering candidates.', location: 'Pune, India',
    url: 'https://careers.example.com/jobs/unknown-date-role',
  }), source, now);
  await transaction(r => r.putMany('jobs', [graduate, older, unknownDate]));

  const fresh = await searchJobs(new URLSearchParams('postedWithinDays=1'));
  assert.deepEqual(fresh.jobs.map(job => job.id), [graduate.id]);
  assert.deepEqual((await searchJobs(new URLSearchParams('internship=true'))).jobs.map(job => job.id), [graduate.id]);
  assert.deepEqual((await searchJobs(new URLSearchParams('entryLevel=true'))).jobs.map(job => job.id).sort(), [graduate.id, unknownDate.id].sort());
  assert.deepEqual((await searchJobs(new URLSearchParams('hasDirectApplication=true'))).jobs.map(job => job.id), [graduate.id]);
  assert.equal((await searchJobs(new URLSearchParams('postedWithinDays=0'))).total, 0);

  const relevant = await searchJobs(new URLSearchParams('q=react&sort=relevant'));
  assert.equal(relevant.searchMode, 'relevant');
  assert.equal(relevant.jobs[0].id, graduate.id);
  assert.ok('relevanceScore' in relevant.jobs[0]);
});

test('social intake holds incomplete posts, enforces permissions and handles removal idempotently', async () => {
 const {ingestSocial}=await import('../src/job-engine/social.ts');
 const input={sourceId:'channel',externalId:'one',url:'https://social.example.com/posts/one',text:'Hiring nurses. Contact our recruitment team for information.',postedAt:new Date().toISOString()};
 await assert.rejects(()=>ingestSocial(input,'admin'));
 await transaction(r=>r.put('socialSources',{id:'channel',name:'Channel',hostname:'social.example.com',permissionEvidence:'Explicit fixture permission for isolated tests.',approved:true,expiresAt:new Date(Date.now()+86400000).toISOString()}));
 assert.equal((await ingestSocial(input,'admin')).state,'review');
 await ingestSocial(input,'admin'); assert.equal(await read(r=>r.count('socialPosts')),1);
 assert.equal(await read(r=>r.count('jobs')),0);
 assert.equal((await ingestSocial({...input,deleted:true},'admin')).state,'removed');
 await assert.rejects(()=>ingestSocial({...input,url:'https://other.example.com/one'},'admin'));
 const risky=normalize(candidate({description:'Please provide your bank login and verification code to get this job.'}),source);
 assert.equal(risky.status,'review'); assert.ok(risky.risk?.reasons.includes('credential_request'));
});

test('semantic index orders vector matches and ignores incompatible vectors', async () => {
 const {semanticMatches}=await import('../src/job-engine/semantic.ts');
 await transaction(r=>r.putMany('jobVectors',[
 {id:'relevant',model:'Xenova/all-MiniLM-L6-v2',fingerprint:'a',vector:[1,0]},
 {id:'unrelated',model:'Xenova/all-MiniLM-L6-v2',fingerprint:'b',vector:[0,1]},
 {id:'wrong-dimension',model:'Xenova/all-MiniLM-L6-v2',fingerprint:'c',vector:[1]},
 ]));
 assert.deepEqual(await semanticMatches('patient care',async()=>[1,0]),[{id:'relevant',score:1}]);
 const {payPeriod}=await import('../src/job-engine/normalize.ts');
 assert.equal(payPeriod('PA'),'annual'); assert.equal(payPeriod('PH'),'hourly'); assert.equal(payPeriod(''),null);
});

test('live discovery sorts by discovery and filters overlapping disclosed experience', async () => {
  const base={...sampleJobs()[0],sample:false};
  const now=Date.now();
  await transaction(async r=>{for(const [i,min,max,disclosed] of [[0,0,2,true],[1,3,5,true],[2,0,0,false]] as const)await r.put('jobs',{...base,id:`live-${i}`,discoveredAt:new Date(now-i*60000).toISOString(),sourcePostedAt:new Date(now+i*60000).toISOString(),experienceMin:min,experienceMax:max,experienceDisclosed:disclosed});});
  const latest=await searchJobs(new URLSearchParams('sort=discovered'));
  assert.equal(latest.jobs[0].id,'live-0');
  assert.equal((await searchJobs(new URLSearchParams('experienceMin=0&experienceMax=2'))).total,1);
  assert.equal((await searchJobs(new URLSearchParams('experienceMin=5&experienceMax=100'))).total,1);
  assert.equal((await searchJobs(new URLSearchParams('experienceMin=bad'))).total,0);
});

test('JobSearch email-only applications use the verified Gmail delivery flow', async () => {
  const config = sourceSchema.parse({ ...source, type: 'jobtech', intervalMinutes: 360, maxPages: 1 });
  const base = { id: 'email-role', headline: 'Support specialist', employer: { name: 'School' }, webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/email-role',
    description: { text: 'Support candidates and customers through a verified recruitment process.' }, workplace_address: { country: 'Sverige', municipality: 'Stockholm' },
    application_details: { email: 'Careers@School.Example.com' }, application_deadline: '2026-12-31T23:59:59' };
  const result = await fetchFeed(config, async () => ({ total: { value: 1 }, hits: [base] }), async () => undefined);
  const job = normalize(result.jobs[0], config);
  assert.equal(job.method, 'email');
  assert.equal(job.email, 'careers@school.example.com');
  assert.equal(job.url, base.webpage_url);

  const invalid = await fetchFeed(config, async () => ({ total: { value: 1 }, hits: [{ ...base, application_details: { email: 'not-an-email' } }] }), async () => undefined);
  assert.equal(normalize(invalid.jobs[0], config).method, 'external', 'unverified email text never becomes a delivery destination');
});

test('job search supports responsive page sizes for infinite loading', async () => {
  const base={...sampleJobs()[0],sample:false};
  const now=Date.now();
  await transaction(async r=>{for(let i=0;i<30;i++)await r.put('jobs',{...base,id:`pagination-${String(i).padStart(2,'0')}`,title:`Pagination Engineer ${i}`,discoveredAt:new Date(now-i*1000).toISOString(),expiresAt:new Date(now+86400000).toISOString()});});
  const desktop=await searchJobs(new URLSearchParams('q=pagination&sort=discovered&limit=24&page=1'));
  const remainder=await searchJobs(new URLSearchParams('q=pagination&sort=discovered&limit=24&page=2'));
  const mobile=await searchJobs(new URLSearchParams('q=pagination&sort=discovered&limit=12&page=1'));
  assert.equal(desktop.jobs.length,24); assert.equal(desktop.hasMore,true);
  assert.equal(remainder.jobs.length,6); assert.equal(remainder.hasMore,false);
  assert.equal(mobile.jobs.length,12); assert.equal(mobile.limit,12);
});
