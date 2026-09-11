import { test, before, after, beforeEach } from 'node:test';
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
import { fetchFeed, FeedError, type Candidate, type FeedBatch } from '../src/job-engine/adapters.ts';
import { runEngine, upsertSource, setEmployerRefresh } from '../src/job-engine/engine.ts';
import { searchJobs } from '../src/lib/search.ts';
import { expireJobs } from '../src/lib/lifecycle.ts';

let replica: MongoMemoryReplSet, client: MongoClient;
const source: FeedSource = { id: 'test-board', type: 'ashby', name: 'Test employer', company: 'Example Employer', board: 'example',
  enabled: true, approved: true, publicListing: true, publish: true, policyEvidence: 'Explicit fixture permission for isolated tests only.', intervalMinutes: 30, maxPages: 2 };
const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({ externalId: 'role-1', title: 'Clinical nurse', company: 'Example Employer',
  url: 'https://careers.example.com/jobs/role-1', description: '<p>Provide excellent patient care &amp; support the clinical team.</p>',
  location: 'London, United Kingdom', postedAt: new Date(Date.now() - 86400000).toISOString(), ...overrides });
const batch = (jobs = [candidate()], overrides: Partial<FeedBatch> = {}): FeedBatch => ({ jobs, complete: true, snapshot: true, requests: 1, ...overrides });
const joobleSource = (): FeedSource => sourceSchema.parse({ ...source, id: 'jooble-gb', type: 'jooble', countryCode: 'gb', intervalMinutes: 1440, maxPages: 1 });

test('expiry scans past a full fresh page and closes only expired jobs', async () => {
  const base = normalize(candidate(), source);
  await transaction(r => r.putMany('jobs', Array.from({ length: 302 }, (_, i) => ({ ...base, id: `expiry-${String(i).padStart(4, '0')}`,
    ...(i >= 300 ? { expiresAt: new Date(Date.now() - 1000).toISOString() } : {}) }))));
  assert.equal(await expireJobs(), 2);
  assert.equal(await read(r => r.count('jobs', { status: 'published' })), 300);
  assert.equal(await expireJobs(), 0);
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
test('paginated adapters never follow arbitrary next URLs and report truncation', async () => {
  const urls: string[] = [];
  const result = await fetchFeed({ ...publicSources.find(s => s.type === 'arbeitnow')!, maxPages: 2 }, async url => {
    urls.push(url); return { data: [{ slug: url, title: 'Teacher', company_name: 'School', url: 'https://www.arbeitnow.com/jobs/teacher', description: 'A complete teaching position description with requirements.', created_at: Date.now() / 1000 }], links: { next: 'http://127.0.0.1/private' } };
  }, async () => undefined);
  assert.equal(result.jobs.length, 2); assert.equal(result.complete, false);
  assert.deepEqual(urls, ['https://www.arbeitnow.com/api/job-board-api?page=1', 'https://www.arbeitnow.com/api/job-board-api?page=2']);
});
test('Ashby, Greenhouse, Lever and Remotive adapters preserve supplied dates and pagination semantics', async () => {
  const ashby = await fetchFeed(source, async () => ({ jobs: [{ id: '1', title: 'Role', isListed: true, jobUrl: 'https://jobs.ashbyhq.com/example/1', publishedAt: '2026-09-01T00:00:00Z', descriptionPlain: 'Role facts', address: { postalAddress: { addressCountry: 'USA' } } }] }));
  assert.equal(ashby.jobs[0].country, 'USA'); assert.ok(ashby.snapshot);
  const gh = await fetchFeed({ ...source, type: 'greenhouse' }, async () => ({ jobs: [{ id: 1, updated_at: '2026-09-01', title: 'Role', absolute_url: 'https://job-boards.greenhouse.io/example/jobs/1', content: 'Role facts', location: { name: 'London' } }] }));
  assert.equal(gh.jobs[0].postedAt, undefined);
  const lever = await fetchFeed({ ...source, type: 'lever' }, async () => [{ id: '1', text: 'Role', hostedUrl: 'https://jobs.lever.co/example/1', categories: { location: 'Remote' }, descriptionPlain: 'Role facts' }]);
  assert.equal(lever.jobs.length, 1); assert.equal(lever.complete, true);
  const remote = await fetchFeed(publicSources.find(s => s.type === 'remotive')!, async () => ({ jobs: [{ id: 1, title: 'Role', url: 'https://remotive.com/jobs/role', company_name: 'Employer', publication_date: '2026-09-01T10:00:00', candidate_required_location: 'Worldwide' }] }));
  assert.equal(remote.jobs[0].postedAt, '2026-09-01T10:00:00.000Z'); assert.equal(remote.snapshot, false);
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
  assert.throws(() => normalize({ ...b.jobs[0], url: 'https://other.example.com/job' }, s));
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
        PositionTitle: 'Librarian', OrganizationName: 'Agency', PositionURI: 'https://www.usajobs.gov/job/1', PositionLocationDisplay: 'Tokyo, Japan', PositionLocation: [{ CountryCode: 'Japan' }], PublicationStartDate: new Date().toISOString(), ApplicationCloseDate: closesAt,
        UserArea: { Details: { JobSummary: 'Manage a research library and its information services.', WhoMayApply: { Name: 'United States Citizens' } } }, PositionSchedule: [{ Name: 'Full Time' }], JobCategory: [{ Name: 'Library Science' }] } }] } };
    });
    const j = normalize(b.jobs[0], { ...source, type: 'usajobs' });
    assert.equal(j.country, 'Japan'); assert.equal(j.expiresAt, closesAt); assert.ok(j.description.includes('United States Citizens'));
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
    const ad = { id: 'a', headline: 'Lärare', employer: { name: 'School' }, webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/a',
      description: { text: 'Teaching children in a supportive school environment.' }, workplace_address: { country: 'Sverige', municipality: 'Stockholm' },
      working_hours_type: { label: 'Heltid' }, occupation: { label: 'Lärare' }, publication_date: '2026-09-11T09:00:00', application_deadline: '2026-12-31T23:59:59' };
    return { total: { value: 101 }, hits: calls === 1 ? Array.from({ length: 100 }, () => ad) : [{ ...ad, removed: true }] };
  }, async () => undefined);
  assert.equal(calls, 2); assert.equal(result.jobs.length, 100); assert.equal(result.complete, true); assert.equal(result.snapshot, false);
  assert.equal(result.jobs[0].country, 'Sweden'); assert.equal(result.jobs[0].employmentType, 'Full-time');
  assert.equal(result.jobs[0].postedAt, undefined); assert.equal(result.jobs[0].closesAt, '2026-12-31T00:00:00.000Z');
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
    return { active: url.endsWith('/one'), name: 'Teacher', postingUrl: 'https://jobs.smartrecruiters.com/example/one', jobAd: { sections: { jobDescription: { text: 'Teach and support students in a welcoming classroom.' } } }, location: { country: 'in' } };
  }, async () => undefined);
  assert.equal(result.jobs.length, 1); assert.equal(result.requests, 3); assert.equal(result.complete, true);
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
