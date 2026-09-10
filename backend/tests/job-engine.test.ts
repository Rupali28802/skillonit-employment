import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { bootstrapIndexes, closeStore, read, transaction } from '../src/lib/store.ts';
import { sampleJobs } from '../src/lib/fixtures.ts';
import { publicJob, type Job } from '../src/lib/domain.ts';
import { sourceSchema, publicSources, type FeedSource } from '../src/job-engine/sources.ts';
import { canonicalUrl, normalize, categoryFor } from '../src/job-engine/normalize.ts';
import { fetchFeed, FeedError, type Candidate, type FeedBatch } from '../src/job-engine/adapters.ts';
import { runEngine, upsertSource } from '../src/job-engine/engine.ts';
import { searchJobs } from '../src/lib/search.ts';

let replica: MongoMemoryReplSet, client: MongoClient;
const source: FeedSource = { id: 'test-board', type: 'ashby', name: 'Test employer', company: 'Example Employer', board: 'example',
  enabled: true, approved: true, publicListing: true, publish: true, policyEvidence: 'Explicit fixture permission for isolated tests only.', intervalMinutes: 30, maxPages: 2 };
const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({ externalId: 'role-1', title: 'Clinical nurse', company: 'Example Employer',
  url: 'https://careers.example.com/jobs/role-1', description: '<p>Provide excellent patient care &amp; support the clinical team.</p>',
  location: 'London, United Kingdom', postedAt: new Date(Date.now() - 86400000).toISOString(), ...overrides });
const batch = (jobs = [candidate()], overrides: Partial<FeedBatch> = {}): FeedBatch => ({ jobs, complete: true, snapshot: true, requests: 1, ...overrides });
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
  assert.equal(sourceSchema.safeParse({ ...publicSources[2], intervalMinutes: 30 }).success, false);
  assert.equal(sourceSchema.safeParse({ ...publicSources[2], publicListing: false }).success, false);
  let calls = 0;
  await assert.rejects(fetchFeed({ ...source, enabled: false }, async () => { calls++; return {}; })); assert.equal(calls, 0);
});
test('paginated adapters never follow arbitrary next URLs and report truncation', async () => {
  const urls: string[] = [];
  const result = await fetchFeed({ ...publicSources[0], maxPages: 2 }, async url => {
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
  const remote = await fetchFeed(publicSources[2], async () => ({ jobs: [{ id: 1, title: 'Role', url: 'https://remotive.com/jobs/role', company_name: 'Employer', publication_date: '2026-09-01T10:00:00', candidate_required_location: 'Worldwide' }] }));
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
