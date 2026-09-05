import type { Job, User } from './domain.js';
import { isRecent, publicJob } from './domain.js';
import { read, configuredPlans } from './store.js';
export async function searchJobs(
  params: URLSearchParams,
  user: User | null = null,
) {
  const query = (params.get('q') || '').slice(0, 200).toLowerCase();
  const ignored = new Set([
    'jobs',
    'job',
    'in',
    'for',
    'a',
    'an',
    'and',
    'or',
    'the',
    'as',
    'with',
  ]);
  const words = query
    .split(/\W+/)
    .filter((w) => w && !ignored.has(w) && w !== 'fresher');
  const category = params.get('category'),
    country = params.get('country'),
    state = params.get('state'),
    mode = params.get('mode');
  const exp = params.get('experience');
  // Bounded database fallback; production SearchProvider should use indexed facets and full text.
  const jobs = await read((r) =>
    r.find<Job>(
      'jobs',
      {
        status: 'published',
        ...(country ? { country } : {}),
        ...(category ? { category } : {}),
        ...(mode ? { mode } : {}),
      },
      1000,
    ),
  );
  const filtered = jobs.filter(
    (j) =>
      isRecent(j) &&
      (!state || j.state === state) &&
      (!query.includes('fresher') || j.experienceMin === 0) &&
      (!exp ||
        (j.experienceMin <= Number(exp) && j.experienceMax >= Number(exp))) &&
      words.every((w) =>
        [j.title, j.category, j.city, j.country, j.mode, ...j.skills]
          .join(' ')
          .toLowerCase()
          .includes(w),
      ),
  );
  filtered.sort(
    params.get('sort') === 'salary'
      ? (a, b) =>
          a.currency.localeCompare(b.currency) || b.salaryMin - a.salaryMin
      : (a, b) => Date.parse(b.discoveredAt) - Date.parse(a.discoveredAt),
  );
  const page = Math.max(1, Math.min(100, Number(params.get('page')) || 1));
  const p = await configuredPlans();
  return {
    jobs: filtered
      .slice((page - 1) * 12, page * 12)
      .map((j) => publicJob(j, user, p)),
    total: filtered.length,
    page,
    hasMore: page * 12 < filtered.length,
  };
}
