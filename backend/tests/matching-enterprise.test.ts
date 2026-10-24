import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleJobs } from '../src/lib/fixtures.js';
import type { User, Profile, Preferences } from '../src/lib/domain.js';
import type { Repository } from '../src/lib/store.js';
import { defaultRankingPolicy, rankingPolicySchema, matchingQuerySchema, candidateMatchingSchema } from '../src/lib/matching-contracts.js';
import { evaluateMatch, emptyCatalogs, salaryFit, locationFit, locationPreferenceTier, occupationFit, candidateEmbeddingText, keywordScore, keywordTerms } from '../src/lib/matching-ranking.js';
import { runMatching } from '../src/lib/matching-engine.js';
import { jobFingerprint, cosine, validateVector, matchingProviderConfig, MatchingTransport, HttpEmbeddingProvider, OpenSearchMatchingProvider, indexMapping } from '../src/lib/matching-providers.js';
import { syncMatchingIndex, removeDeletedIndexEntries } from '../src/lib/matching-indexer.js';

const now = Date.now(), job = { ...sampleJobs()[0], discoveredAt: new Date(now - 86400000).toISOString(), expiresAt: new Date(now + 86400000).toISOString() };
const profile: Profile = { name: 'Private name', headline: job.title, skills: job.skills, experience: job.experienceMin, education: '', country: '', city: '', confirmed: true };
const preferences: Preferences = { roles: [job.title], relatedRoles: [], countries: [], modes: [job.mode], exclusions: [], automation: false, dailyCap: 5 };
const user = { id: 'candidate', role: 'student', verified: true, profile, preferences } as User;
const policy = defaultRankingPolicy();
const evaluate = (j = job, p = profile, prefs = preferences, cfg = policy) => evaluateMatch(j, user, p, prefs, emptyCatalogs(), cfg, { keyword: 1, semantic: null }, now);
function repository(seed: Record<string, any[]> = {}): Repository {
  const data = new Map(Object.entries(seed).map(([c, rows]) => [c, new Map(rows.map(row => [row.id, structuredClone(row)]))]));
  const find = (c: string, q: Record<string, unknown> = {}) => [...(data.get(c)?.values() ?? [])].filter(row => Object.entries(q).every(([k, v]) => row[k] === v));
  return {
    async get<T>(c: string, id: string) { return structuredClone(data.get(c)?.get(id) ?? null) as T | null; },
    async put(c, row) { if (!data.has(c)) data.set(c, new Map()); data.get(c)!.set(row.id, structuredClone(row)); },
    async remove(c, id) { data.get(c)?.delete(id); },
    async count(c, q) { return find(c, q).length; },
    async find<T>(c: string, q = {}, limit = 100) { return structuredClone(find(c, q).slice(0, limit)) as T[]; },
    async scan<T>(c: string, q: Record<string, unknown>, after = '', limit = 250) { return structuredClone(find(c, q).filter(row => row.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit)) as T[]; },
  };
}

test('hard eligibility excludes unavailable/unverified/expired jobs and missing mandatory skills', () => {
  for (const modified of [{ ...job, status: 'closed' as const }, { ...job, expiresAt: new Date(now).toISOString() }, { ...job, matching: { requiredSkills: ['Unconfirmed qualification'] } }]) {
    assert.equal(evaluate(modified).hardEligibility.status, 'INELIGIBLE'); assert.equal(evaluate(modified).score, 0);
  }
  assert.equal(evaluate(job, { ...profile, confirmed: false }).score, 0);
  assert.ok(evaluateMatch(job, { ...user, verified: false }, profile, preferences, emptyCatalogs(), policy, { keyword: 1, semantic: null }, now).exclusions.includes('EMAIL_UNVERIFIED'));
});
test('education, work authorization and experience remain unknown until confirmed', () => {
  const required = { ...job, matching: { requiredEducationLevels: ['bachelor'], workAuthorizationRequired: true, experienceRequired: true } };
  const result = evaluate(required, { ...profile, experience: null, education: 'Bachelor degree written in an unstructured narrative' });
  assert.equal(result.hardEligibility.status, 'NEEDS_REVIEW');
  assert.deepEqual(result.hardEligibility.needsReview.sort(), ['EDUCATION_LEVEL_UNKNOWN', 'EXPERIENCE_UNKNOWN', 'WORK_AUTHORIZATION_UNKNOWN']);
  assert.equal(evaluate(required, { ...profile, experience: null }, preferences, { ...policy, unknownHardRequirement: 'exclude' }).score, 0);
  const confirmed = { ...profile, matching: { educationLevels: ['bachelor'], authorizedCountries: [job.country] } };
  assert.equal(evaluate(required, confirmed).hardEligibility.status, 'ELIGIBLE');
  assert.equal(evaluate(required, { ...confirmed, matching: { ...confirmed.matching, authorizedCountries: [], requiresSponsorship: true } }).score, 0);
});
test('fresher zero experience is known; salary periods normalize without invented FX or hours', () => {
  assert.equal(evaluate({ ...job, experienceMin: 0, experienceMax: 0 }, { ...profile, experience: 0 }).breakdown.experience, 1);
  const j = { ...job, currency: 'INR', salaryMin: 10000, salaryMax: 20000, matching: { salaryPeriod: 'month' as const } };
  const p = { ...preferences, salary: { min: 120000, max: 240000, currency: 'INR', period: 'year' as const } };
  assert.equal(salaryFit(j, p), 1);
  assert.equal(salaryFit(j, { ...p, salary: { ...p.salary, currency: 'USD' } }), null);
  assert.equal(salaryFit(j, { ...p, salary: { ...p.salary, period: 'hour' } }), null);
  assert.equal(salaryFit(j, { ...p, salary: { ...p.salary, min: 300000, max: 400000 } }), 0);
});
test('catalog hierarchy and explicit aliases work without adding unrelated occupations', () => {
  const catalogs = emptyCatalogs();
  catalogs.locations = [{ id: 'country', active: true, displayName: 'India', type: 'country' }, { id: 'city', active: true, displayName: 'Pune', parentId: 'country', type: 'city' }];
  assert.equal(locationFit({ ...job, matching: { locationId: 'city' } }, { ...preferences, countries: ['country'] }, catalogs), 1);
  catalogs.occupations = [{ id: 'engineering', active: true, displayName: 'Engineering' }, { id: 'software', active: true, displayName: 'Software Engineer', parentId: 'engineering' }];
  assert.equal(occupationFit({ ...job, matching: { occupationId: 'software' } }, profile, { ...preferences, roles: ['engineering'] }, catalogs), 1);
  assert.equal(occupationFit({ ...job, title: 'Nurse' }, profile, { ...preferences, roles: ['software'] }, catalogs), 0);
  catalogs.skills = [{ id: 'js', active: true, displayName: 'JavaScript', aliases: ['ECMAScript'] }];
  const result = evaluateMatch({ ...job, skills: ['JavaScript'] }, user, { ...profile, skills: ['ECMAScript'] }, preferences, catalogs, policy, { keyword: 0, semantic: null }, now);
  assert.deepEqual(result.matchedSkills, ['javascript']);
});
test('selected cities rank first while other verified jobs in selected countries remain eligible', async () => {
  const catalogs = emptyCatalogs();
  catalogs.locations = [
    { id: 'india', active: true, displayName: 'India', countryCode: 'IN', type: 'country' },
    { id: 'pune', active: true, displayName: 'Pune', countryCode: 'IN', parentId: 'india', type: 'city' },
    { id: 'mumbai', active: true, displayName: 'Mumbai', countryCode: 'IN', parentId: 'india', type: 'city' },
  ];
  const cityJob = { ...job, id: 'city-first', city: 'Pune', country: 'India', matching: { locationId: 'pune' } };
  const countryJob = { ...job, id: 'country-next', city: 'Mumbai', country: 'India', matching: { locationId: 'mumbai' } };
  const preferencesWithLocation = { ...preferences, countries: ['india'], cities: ['pune'] };
  assert.equal(locationFit(cityJob, preferencesWithLocation, catalogs), 1);
  assert.equal(locationFit(countryJob, preferencesWithLocation, catalogs), 0.75);
  assert.equal(locationPreferenceTier(cityJob, preferencesWithLocation, catalogs), 1);
  assert.equal(locationPreferenceTier(countryJob, preferencesWithLocation, catalogs), 0);
  const r = repository({
    jobs: [countryJob, cityJob],
    locations: catalogs.locations,
  });
  const result = await runMatching(r, { ...user, preferences: preferencesWithLocation }, {}, { semantic: false, candidateEmbeddingAllowed: false }, now);
  assert.deepEqual(result.items.map(item => item.job.id), ['city-first', 'country-next']);
});
test('weights are validated, freshness decays and explanations reproduce score', () => {
  const result = evaluate();
  const points = result.explanations.reduce((n, e) => n + e.points, 0), weights = result.explanations.reduce((n, e) => n + e.weight, 0);
  assert.equal(result.score, Math.round(100 * points / weights));
  assert.ok(evaluate({ ...job, discoveredAt: new Date(now - 60 * 86400000).toISOString() }).score < result.score);
  assert.throws(() => rankingPolicySchema.parse({ weights: Object.fromEntries(Object.keys(policy.weights).map(k => [k, 0])) }));
  assert.throws(() => matchingQuerySchema.parse({ q: { $ne: null } }));
  assert.throws(() => candidateMatchingSchema.parse({ verified: true }));
});
test('keyword retrieval is literal and embedding input excludes contact fields and raw CV', () => {
  assert.equal(keywordScore({ ...job, title: 'JavaScript engineer', skills: [], description: '', requirements: '', category: '' }, ['java']), 0);
  assert.deepEqual(keywordTerms({ ...profile, confirmed: false }, preferences), []);
  const text = candidateEmbeddingText({ ...profile, headline: 'Engineer private@example.invalid https://example.invalid +91 9999999999' });
  assert.ok(!text.includes('Private name')); assert.ok(!text.includes('@')); assert.ok(!text.includes('https')); assert.ok(!text.includes('99999'));
});
test('engine requires confirmed provenance and never embeds without consent', async () => {
  let calls = 0;
  const embeddings = { version: 'v1', dimensions: 2, async embed() { calls++; return [1, 0]; } };
  const r = repository({ jobs: [job] });
  const providers = { semantic: true, candidateEmbeddingAllowed: true, embeddings };
  assert.equal((await runMatching(r, { ...user, profile: { ...profile, confirmed: false } }, {}, providers)).status, 'PROFILE_UNCONFIRMED');
  assert.equal((await runMatching(r, user, {}, providers)).semantic, 'CONSENT_REQUIRED'); assert.equal(calls, 0);
  await r.put('candidateConsents', { id: user.id + ':profile', granted: false });
  assert.equal((await runMatching(r, user, {}, providers)).status, 'PROFILE_CONSENT_REVOKED');
  await r.put('candidateConsents', { id: user.id + ':profile', granted: true });
  await runMatching(r, user, {}, providers); assert.equal(calls, 1);
});
test('authoritative hydration excludes deleted jobs and refuses stale vectors; provider failure is explicit', async () => {
  const r = repository({ jobs: [job], candidateConsents: [{ id: user.id + ':profile', granted: true }] });
  const search = { async retrieve() { return [{ id: 'deleted', fingerprint: jobFingerprint(job) }, { id: job.id, fingerprint: '0'.repeat(64), vector: [1, 0], vectorVersion: 'v1' }]; }, async index() {}, async remove() {} };
  const result = await runMatching(r, user, {}, { search, semantic: true, candidateEmbeddingAllowed: true, embeddings: { version: 'v1', dimensions: 2, async embed() { return [1, 0]; } } }, now);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].match.breakdown.semantic, null); assert.ok(result.degraded.includes('STALE_INDEX_DOCUMENT'));
  search.retrieve = async () => { throw new Error('provider internals must not escape'); };
  const fallback = await runMatching(r, user, {}, { search, semantic: false, candidateEmbeddingAllowed: false }, now);
  assert.ok(fallback.degraded.includes('OPENSEARCH_UNAVAILABLE')); assert.equal(fallback.items.length, 1);
  await r.put('systemConfig', { id: 'job-matching-policy', revision: 1, value: { ...policy, allowKeywordFallback: false } });
  await assert.rejects(runMatching(r, user, {}, { search, semantic: false, candidateEmbeddingAllowed: false }, now), /Matching provider is unavailable/);
});
test('vector/config validation rejects unsafe endpoints and malformed vectors', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1); assert.equal(cosine([1, 0], [0, 1]), 0);
  for (const vector of [[0, 0], [1], [Infinity, 0]]) assert.throws(() => validateVector(vector, 2));
  assert.throws(() => matchingProviderConfig({ MATCHING_SEARCH_PROVIDER: 'opensearch', MATCHING_OPENSEARCH_URL: 'http://example.invalid' }), /MATCHING_PROVIDER_CONFIG/);
  const aiven = matchingProviderConfig({ MATCHING_SEARCH_PROVIDER: 'aiven', MATCHING_OPENSEARCH_URL: 'https://search.example.invalid:12345', MATCHING_OPENSEARCH_USERNAME: 'service-user', MATCHING_OPENSEARCH_PASSWORD: 'secret-value' });
  assert.equal(aiven.provider, 'aiven'); assert.match(aiven.authorization!, /^Basic /);
  assert.throws(() => matchingProviderConfig({ MATCHING_SEARCH_PROVIDER: 'aiven', MATCHING_OPENSEARCH_URL: 'https://search.example.invalid', MATCHING_OPENSEARCH_USERNAME: 'user:name', MATCHING_OPENSEARCH_PASSWORD: 'secret' }), /MATCHING_PROVIDER_CONFIG/);
  assert.equal(indexMapping(2).mappings.properties.embedding?.dimension, 2);
});
test('OpenSearch HTTP contract uses filtered keyword and versioned vector retrieval, never query_string', async () => {
  const requests: any[] = [];
  const transport = new MatchingTransport(1000, (async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ hits: { hits: [] } }); }) as typeof fetch);
  // Transport-only contract double; this does not authenticate with an external service.
  const provider = new OpenSearchMatchingProvider({ provider: 'opensearch', semantic: true, endpoint: 'https://search.example.invalid', authorization: 'Bearer contract-only', index: 'jobs', timeoutMs: 1000, candidateEmbeddingAllowed: true }, transport, { dimensions: 2, version: 'v1', async embed() { return [1, 0]; } });
  await provider.retrieve(['developer'], [1, 0], policy, now);
  assert.equal(requests.length, 2); assert.ok(requests[0].query.bool.must[0].multi_match);
  assert.equal(requests[1].query.knn.embedding.filter.bool.filter.at(-1).term.vectorVersion, 'v1');
  assert.ok(!JSON.stringify(requests).includes('query_string'));
  await assert.rejects(provider.remove('../escape'));
});
test('transport retries transient HTTP failures and redacts upstream error bodies', async () => {
  let calls = 0;
  const transport = new MatchingTransport(1000, (async () => ++calls === 1 ? new Response('private upstream body', { status: 503 }) : Response.json({ ok: true })) as typeof fetch);
  assert.deepEqual(await transport.json('https://example.invalid', { method: 'GET' }), { ok: true }); assert.equal(calls, 2);
  const failed = new MatchingTransport(1000, (async () => new Response('sensitive upstream body', { status: 401 })) as typeof fetch);
  await assert.rejects(failed.json('https://example.invalid', {}), error => error instanceof Error && !error.message.includes('sensitive'));
});
test('indexer is replay-safe, refreshes changed jobs, removes deleted jobs and writes state only after success', async () => {
  const r = repository({ jobs: [job] }); let writes = 0, removals = 0;
  const search = { async retrieve() { return []; }, async index() { writes++; }, async remove() { removals++; } };
  assert.equal((await syncMatchingIndex(r, search, undefined, policy, { version: 'v1' }, now)).indexed, 1);
  assert.equal((await syncMatchingIndex(r, search, undefined, policy, { version: 'v1' }, now)).skipped, 1);
  await r.put('jobs', { ...job, title: job.title + ' revised' });
  await syncMatchingIndex(r, search, undefined, policy, { version: 'v1' }, now); assert.equal(writes, 2);
  await r.remove('jobs', job.id); await removeDeletedIndexEntries(r, search); assert.equal(removals, 1);
  await r.put('jobs', job); search.index = async () => { throw new Error('unavailable'); };
  await assert.rejects(syncMatchingIndex(r, search, undefined, policy, { version: 'v2' }, now));
  assert.equal(await r.get('matchingIndexState', job.id), null);
});
test('embedding HTTP contract enforces model, dimensions and finite values', async () => {
  let payload: any;
  let reply: unknown = { model: 'contract-model', data: [{ index: 0, embedding: [1, 0] }] };
  const adapter = new HttpEmbeddingProvider({ provider: 'openai', endpoint: 'https://embedding.example.invalid/v1/embeddings', token: 'contract-only', model: 'contract-model', version: 'v1', dimensions: 2 },
    new MatchingTransport(1000, (async (_url, init) => { payload = JSON.parse(String(init?.body)); return Response.json(reply); }) as typeof fetch));
  assert.deepEqual(await adapter.embed('Confirmed skills'), [1, 0]);
  assert.deepEqual(payload, { model: 'contract-model', input: 'Confirmed skills', dimensions: 2, encoding_format: 'float' });
  for (const bad of [{ model: 'other', data: [{ index: 0, embedding: [1, 0] }] }, { model: 'contract-model', data: [{ index: 0, embedding: [1] }] }]) {
    reply = bad; await assert.rejects(adapter.embed('Confirmed skills'), /EMBEDDING_UNAVAILABLE/);
  }
  assert.equal(cosine([1e-200, 0], [1e-200, 0]), 1);
});
test('Gemini embedding contract reuses the protected token variable and validates dimensions', async () => {
  let payload: any, headers: HeadersInit | undefined;
  const adapter = new HttpEmbeddingProvider({ provider: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', token: 'contract-only', model: 'gemini-embedding-001', version: 'gemini-v1', dimensions: 2 },
    new MatchingTransport(1000, (async (_url, init) => { payload = JSON.parse(String(init?.body)); headers = init?.headers; return Response.json({ embedding: { values: [1, 0] } }); }) as typeof fetch));
  assert.deepEqual(await adapter.embed('Confirmed skills'), [1, 0]);
  assert.deepEqual(payload, { content: { parts: [{ text: 'Confirmed skills' }] }, output_dimensionality: 2 });
  assert.equal((headers as Record<string, string>)['x-goog-api-key'], 'contract-only');
  assert.equal((headers as Record<string, string>).Authorization, undefined);
  assert.throws(() => matchingProviderConfig({ MATCHING_SEARCH_PROVIDER: 'opensearch', MATCHING_OPENSEARCH_URL: 'https://search.example.test', MATCHING_OPENSEARCH_AUTHORIZATION: 'Bearer contract', MATCHING_SEMANTIC: 'on', MATCHING_EMBEDDING_PROVIDER: 'gemini', MATCHING_EMBEDDING_URL: 'https://evil.example.test/v1beta/models/gemini-embedding-001:embedContent', MATCHING_EMBEDDING_TOKEN: 'secret', MATCHING_EMBEDDING_MODEL: 'gemini-embedding-001', MATCHING_EMBEDDING_VERSION: 'v1', MATCHING_EMBEDDING_DIMENSIONS: '2' }), /MATCHING_PROVIDER_CONFIG/);
});
test('explicit unconfirmed CV-derived fields never contribute to ranking or embeddings', async () => {
  const r = repository({ jobs: [job], candidateConsents: [{ id: user.id + ':profile', granted: true }] });
  let embedded = '';
  const result = await runMatching(r, { ...user, preferences: { ...preferences, roles: [] },
    profile: { ...profile, matching: { educationLevels: ['Unapproved degree'] } },
    profileProvenance: Object.fromEntries(['skills', 'headline', 'matching'].map(k => [k, { source: 'CV_EXTRACTED', status: 'UNCONFIRMED' }])) }, {},
    { semantic: true, candidateEmbeddingAllowed: true, embeddings: { version: 'v1', dimensions: 2, async embed(text) { embedded = text; return [1, 0]; } } }, now);
  assert.equal(embedded, ''); assert.deepEqual(result.items, []);
});
test('bounded retrieval pagination and stable ties are explicit', async () => {
  const r = repository({ jobs: Array.from({ length: 35 }, (_, i) => ({ ...job, id: 'rank-' + String(i).padStart(3, '0') })),
    systemConfig: [{ id: 'job-matching-policy', revision: 1, value: { ...policy, candidatePool: 30 } }] });
  const result = await runMatching(r, user, { limit: 10, offset: 10 }, { semantic: false, candidateEmbeddingAllowed: false }, now);
  assert.equal(result.items[0].job.id, 'rank-010'); assert.equal(result.nextOffset, 20); assert.equal(result.truncated, true); assert.equal(result.totalInCandidatePool, 30);
});
test('index validation rejects incompatible vector mappings without replacing them', async () => {
  let writes = 0;
  const mapping = indexMapping(2).mappings;
  const adapter = new OpenSearchMatchingProvider({ provider: 'opensearch', semantic: true, endpoint: 'https://search.example.invalid', authorization: 'Bearer contract-only', index: 'jobs', timeoutMs: 1000, candidateEmbeddingAllowed: true },
    new MatchingTransport(1000, (async (_url, init) => { if (init?.method !== 'GET') writes++; return Response.json({ jobs: { mappings: mapping } }); }) as typeof fetch),
    { version: 'v1', dimensions: 2, async embed() { return [1, 0]; } });
  await adapter.ensureIndex();
  mapping.properties.embedding!.dimension = 3;
  await assert.rejects(adapter.ensureIndex(), /OPENSEARCH_REINDEX_REQUIRED/); assert.equal(writes, 0);
});
