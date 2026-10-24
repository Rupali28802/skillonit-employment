import type { Job, User } from './domain.js';
import { publicJob } from './domain.js';
import { read, configuredPlans, demoMode } from './store.js';
import { normalizeCountry } from './countries.js';
import { semanticMatches } from '../job-engine/semantic.js';
import { postgresConfigured, postgresPublicCountrySearch, postgresPublicFacetSearch, postgresPublicKeywordSearch, postgresPublicTypeSearch, postgresReadWithTimeout } from './postgres-store.js';

type RawSearchResult = { jobs: Job[]; total: number };

// The public landing page and its live-discovery panel can request the same first
// page at once. Coalesce that work for a few seconds so concurrent visitors do
// not queue identical database count queries behind each other. The cache keeps
// only public job documents; user-specific shaping still happens below.
const publicFeedRequests = new Map<string, { expiresAt: number; value: Promise<RawSearchResult> }>();
// Discovery refreshes on a multi-minute cadence. Keeping an anonymous default
// page for one minute avoids repeated full exact-count scans while still
// surfacing newly discovered jobs promptly and without changing any filters.
const PUBLIC_FEED_TTL_MS = 60_000;

function publicFeedCacheKey(params: URLSearchParams) {
  return [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
}

function cachedPublicFeed(key: string, load: () => Promise<RawSearchResult>) {
  const now = Date.now();
  const cached = publicFeedRequests.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = load().catch(error => {
    if (publicFeedRequests.get(key)?.value === value) publicFeedRequests.delete(key);
    throw error;
  });
  publicFeedRequests.set(key, { expiresAt: now + PUBLIC_FEED_TTL_MS, value });
  return value;
}

export async function searchJobs(params: URLSearchParams, user: User | null = null) {
  const query = (params.get('q') || '').slice(0, 200).toLowerCase();
  const ignored = new Set(['jobs', 'job', 'in', 'for', 'a', 'an', 'and', 'or', 'the', 'as', 'with', 'fresher']);
  const words = query.split(/[^\p{L}\p{N}+#.-]+/u).filter(w => w && !ignored.has(w)).slice(0, 15);
  const now = new Date();
  const filter: Record<string, unknown> = {
    status: 'published', expiresAt: { $gt: now.toISOString() },
    ...(!demoMode() ? { sample: { $ne: true } } : {}),
  };
  const exact = (value: string) => new RegExp('^' + value.slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
  const clauses: Record<string, unknown>[] = [];
  if (params.get('city')) filter.city = exact(params.get('city')!);
  if (params.get('trust')) filter.trust = params.get('trust')!.slice(0, 30);
  if (params.get('source')) filter.source = exact(params.get('source')!);
  if (params.get('company')) { filter.company = exact(params.get('company')!); filter['feed.publicListing'] = true; }
  if (params.get('mnc') === 'true') filter.mnc = true;
  if (params.get('skills')) for (const skill of params.get('skills')!.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20)) clauses.push({ skills: exact(skill) });
  const salaryRequested = params.has('salaryMin') || params.has('salaryMax');
  if (salaryRequested) {
    const min = params.has('salaryMin') ? Number(params.get('salaryMin')) : 0;
    const max = params.has('salaryMax') ? Number(params.get('salaryMax')) : Number.MAX_VALUE;
    const currency = (params.get('currency') || '').toUpperCase();
    const period = params.get('salaryPeriod') || '';
    // Never compare different currencies/units or interpret undisclosed pay as zero.
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min || !/^[A-Z]{3}$/.test(currency) || !period) filter.id = '__invalid_salary_filter__';
    else {
      filter.salaryDisclosed = true; filter.currency = currency;
      filter['normalizedFacts.salary.period'] = exact(period);
      filter.salaryMax = { $gte: min }; filter.salaryMin = { $lte: max };
    }
  }
  for (const key of ['category', 'state', 'mode']) if (params.get(key)) filter[key] = params.get(key)!.slice(0, 120);
  if (params.get('country')) {
    const country = normalizeCountry(params.get('country')!) || params.get('country')!.slice(0, 120);
    filter.$or = [{ country }, { eligibleCountries: country }];
  }
  if (params.get('type')) {
    const type = params.get('type')!.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ _-]+/g, '[ _-]*');
    filter.type = new RegExp(type, 'i');
  }
  const experience = params.get('experience');
  if (params.has('experienceMin') || params.has('experienceMax')) {
    const min = Number(params.get('experienceMin') || 0), max = Number(params.get('experienceMax') || 100);
    if (Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min) {
      filter.experienceMin = {$lte:max}; filter.experienceMax = {$gte:min}; filter.experienceDisclosed = {$ne:false};
    } else filter.id='__invalid_experience_filter__';
  }
  if (query.includes('fresher')) { filter.experienceMin = 0; filter.experienceDisclosed = { $ne: false }; }
  if (experience && Number.isFinite(Number(experience)) && Number(experience) >= 0) {
    filter.experienceMin = { $lte: Number(experience) }; filter.experienceMax = { $gte: Number(experience) };
    filter.experienceDisclosed = { $ne: false };
  }
  let semantic: {id:string;score:number}[] | undefined;
  if (query && params.get('searchMode') === 'semantic') {
    try { semantic = await semanticMatches(query); } catch { /* Text fallback if model unavailable. */ }
  }
  if (semantic) { clauses.push({ id: { $in: semantic.map(m => m.id) } }); filter['feed.publicListing'] = true; }
  if (!semantic && words.length) clauses.push(...words.map(w => {
    const regex = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const country = normalizeCountry(w);
    return { $or: [...['title', 'category', 'state', 'city', 'country', 'mode', 'skills', 'type', 'description', 'normalizedFacts.sourceCategory', 'normalizedFacts.sourceTags'].map(field => ({ [field]: regex })),
      { company: regex, 'feed.publicListing': true },
      ...(country ? [{ country }, { eligibleCountries: country }] : [])] };
  }));
  if (clauses.length) filter.$and = clauses;
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.get('page')) || 1)));
  const requestedLimit = Math.floor(Number(params.get('limit')) || 12);
  const limit = Math.max(10, Math.min(25, requestedLimit));
  const sort: Record<string, 1 | -1> = params.get('sort') === 'salary'
    ? { currency: 1, salaryMin: -1, id: 1 } : params.get('sort') === 'discovered' ? {discoveredAt:-1,id:1} : { sourcePostedAt: -1, discoveredAt: -1, id: 1 };
  // Keep the new SQL projections that need specialised index coverage behind
  // an explicit release flag. Category and work-mode already have matching
  // ordered partial indexes and retain exact repository equality semantics,
  // so they can use the bounded PostgreSQL path unconditionally.
  const optimizedPublicSearch = process.env.ENABLE_POSTGRES_PUBLIC_SEARCH_OPTIMIZATION === 'true';
  // Keep the common search-box query on the database. Facets, semantic search,
  // and non-default ordering retain the existing repository matcher because
  // they carry more detailed Mongo-compatible semantics.
  const simpleKeywordSearch = optimizedPublicSearch && postgresConfigured() && words.length > 0 && !semantic &&
    [...params.keys()].every(key => ['q', 'page', 'limit', 'sort'].includes(key)) &&
    params.get('sort') !== 'salary';
  if (simpleKeywordSearch) {
    const result = await postgresPublicKeywordSearch<Job>(words, params.get('sort') === 'discovered' ? 'discovered' : 'posted', (page - 1) * limit, limit);
    const plans = await configuredPlans();
    return { jobs: result.jobs.map(job => publicJob(job, user, plans)), total: result.total, page, limit, hasMore: page * limit < result.total };
  }
  const simpleCountrySearch = optimizedPublicSearch && postgresConfigured() && !query && !semantic && Boolean(params.get('country')) &&
    [...params.keys()].every(key => ['country', 'page', 'limit', 'sort'].includes(key)) &&
    params.get('sort') !== 'salary';
  if (simpleCountrySearch) {
    const country = normalizeCountry(params.get('country')!) || params.get('country')!.slice(0, 120);
    const result = await postgresPublicCountrySearch<Job>(country, params.get('sort') === 'discovered' ? 'discovered' : 'posted', (page - 1) * limit, limit);
    const plans = await configuredPlans();
    return { jobs: result.jobs.map(job => publicJob(job, user, plans)), total: result.total, page, limit, hasMore: page * limit < result.total };
  }
  const simpleFacetSearch = postgresConfigured() && !query && !semantic &&
    ['category', 'mode'].filter(key => Boolean(params.get(key))).length === 1 &&
    [...params.keys()].every(key => ['category', 'mode', 'page', 'limit', 'sort'].includes(key)) &&
    params.get('sort') !== 'salary';
  if (simpleFacetSearch) {
    const field = params.get('category') ? 'category' : 'mode';
    const result = await postgresPublicFacetSearch<Job>(field, params.get(field)!, params.get('sort') === 'discovered' ? 'discovered' : 'posted', (page - 1) * limit, limit);
    const plans = await configuredPlans();
    return { jobs: result.jobs.map(job => publicJob(job, user, plans)), total: result.total, page, limit, hasMore: page * limit < result.total };
  }
  const requestedType = params.get('type') || '';
  const normalizedType = requestedType.toLowerCase().replace(/[ _-]+/g, '');
  const selectableTypes = new Set(['fulltime', 'parttime', 'permanent', 'contract', 'temporary', 'internship', 'apprenticeship', 'freelance', 'volunteer']);
  const simpleTypeSearch = optimizedPublicSearch && postgresConfigured() && !query && !semantic && selectableTypes.has(normalizedType) &&
    [...params.keys()].every(key => ['type', 'page', 'limit', 'sort'].includes(key)) &&
    params.get('sort') !== 'salary';
  if (simpleTypeSearch) {
    const result = await postgresPublicTypeSearch<Job>(normalizedType, params.get('sort') === 'discovered' ? 'discovered' : 'posted', (page - 1) * limit, limit);
    const plans = await configuredPlans();
    return { jobs: result.jobs.map(job => publicJob(job, user, plans)), total: result.total, page, limit, hasMore: page * limit < result.total };
  }
  const load = () => {
    const run = async (r: Parameters<Parameters<typeof read>[0]>[0]) => ({
      jobs: await r.page<Job>('jobs', filter, sort, (page - 1) * limit, limit), total: await r.count('jobs', filter),
    });
    return postgresConfigured() ? postgresReadWithTimeout(8000, run) : read(run);
  };
  // Cache only the anonymous/default public listing in production. Faceted and
  // semantic searches remain live, while repeated homepage refreshes share one
  // read instead of overwhelming the API/database connection pool.
  const emptyHomepageFilters = new Set(['q', 'category', 'country', 'mode', 'type', 'experience', 'state']);
  const isDefaultPublicFeed = !query && !semantic && [...params.entries()].every(([key, value]) =>
    ['page', 'limit', 'sort', 'searchMode'].includes(key) || (emptyHomepageFilters.has(key) && value === ''),
  );
  // Workers run in separate processes in production, so an in-memory cache
  // cannot observe a discovery write by itself. The engine advances this
  // durable version after each visible feed change; include it in the cache
  // key so a new job is visible on the very next public request.
  const feedVersion = isDefaultPublicFeed
    ? await read(r => r.get<{ version?: string }>('jobEngineState', 'feed-version'))
    : null;
  const result = postgresConfigured() && isDefaultPublicFeed
    ? await cachedPublicFeed(`${publicFeedCacheKey(params)}:${feedVersion?.version || 'initial'}`, load)
    : await load();
  const plans = await configuredPlans();
  if (semantic) {
    // Apply every eligibility/facet filter before ranking or pagination.
    const jobs = await read(r => r.find<Job>('jobs',filter,10000));
    const scores = new Map(semantic.map(m=>[m.id,m.score]));
    jobs.sort((a,b)=>(scores.get(b.id)||0)-(scores.get(a.id)||0)||a.id.localeCompare(b.id));
    return {jobs:jobs.slice((page-1)*limit,page*limit).map(j=>({...publicJob(j,user,plans),semanticScore:scores.get(j.id)})),total:jobs.length,page,limit,hasMore:page*limit<jobs.length,searchMode:'semantic',indexScope:'public indexed vacancies'};
  }
  return { jobs: result.jobs.map(j => publicJob(j, user, plans)), total: result.total, page, limit, hasMore: page * limit < result.total };
}
