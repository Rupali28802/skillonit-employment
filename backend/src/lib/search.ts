import type { Job, User } from './domain.js';
import { publicJob } from './domain.js';
import { read, configuredPlans, demoMode } from './store.js';
import { normalizeCountry } from './countries.js';

export async function searchJobs(params: URLSearchParams, user: User | null = null) {
  const query = (params.get('q') || '').slice(0, 200).toLowerCase();
  const ignored = new Set(['jobs', 'job', 'in', 'for', 'a', 'an', 'and', 'or', 'the', 'as', 'with', 'fresher']);
  const words = query.split(/[^\p{L}\p{N}+#.-]+/u).filter(w => w && !ignored.has(w)).slice(0, 15);
  const now = new Date();
  const filter: Record<string, unknown> = {
    status: 'published', discoveredAt: { $gte: new Date(now.getTime() - 90 * 86400000).toISOString() },
    expiresAt: { $gt: now.toISOString() }, ...(!demoMode() ? { sample: { $ne: true } } : {}),
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
  if (query.includes('fresher')) { filter.experienceMin = 0; filter.experienceDisclosed = { $ne: false }; }
  if (experience && Number.isFinite(Number(experience)) && Number(experience) >= 0) {
    filter.experienceMin = { $lte: Number(experience) }; filter.experienceMax = { $gte: Number(experience) };
    filter.experienceDisclosed = { $ne: false };
  }
  if (words.length) clauses.push(...words.map(w => {
    const regex = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const country = normalizeCountry(w);
    return { $or: [...['title', 'category', 'state', 'city', 'country', 'mode', 'skills', 'type', 'description', 'normalizedFacts.sourceCategory', 'normalizedFacts.sourceTags'].map(field => ({ [field]: regex })),
      { company: regex, 'feed.publicListing': true },
      ...(country ? [{ country }, { eligibleCountries: country }] : [])] };
  }));
  if (clauses.length) filter.$and = clauses;
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.get('page')) || 1)));
  const sort: Record<string, 1 | -1> = params.get('sort') === 'salary'
    ? { currency: 1, salaryMin: -1, id: 1 } : { sourcePostedAt: -1, discoveredAt: -1, id: 1 };
  const result = await read(async r => ({ jobs: await r.page<Job>('jobs', filter, sort, (page - 1) * 12, 12), total: await r.count('jobs', filter) }));
  const plans = await configuredPlans();
  return { jobs: result.jobs.map(j => publicJob(j, user, plans)), total: result.total, page, hasMore: page * 12 < result.total };
}
