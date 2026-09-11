import { read, transaction } from '../lib/store.js';
import type { Job } from '../lib/domain.js';
import { countryEntries } from '../lib/countries.js';
import type { FeedSource } from './sources.js';
import type { SourceState } from './engine.js';

export async function coverageReport() {
  const countryCounts = new Map(countryEntries.map(c => [c.name, 0]));
  const domains: Record<string, number> = {}, types: Record<string, number> = {};
  let cursor = '', total = 0, worldwide = 0, unknownGeography = 0;
  const now = new Date();
  for (;;) {
    const jobs = await read(r => r.scan<Job>('jobs', { status: 'published', sample: { $ne: true },
      discoveredAt: { $gte: new Date(now.getTime() - 90 * 86400000).toISOString() }, expiresAt: { $gt: now.toISOString() } }, cursor, 500));
    if (!jobs.length) break;
    for (const j of jobs) {
      total++; domains[j.category] = (domains[j.category] || 0) + 1; types[j.type] = (types[j.type] || 0) + 1;
      if (j.country === 'Worldwide') worldwide++;
      const names = [...new Set([j.country, ...(j.eligibleCountries || [])])].filter(c => countryCounts.has(c));
      if (!names.length && j.country !== 'Worldwide') unknownGeography++;
      for (const c of names) countryCounts.set(c, countryCounts.get(c)! + 1);
    }
    cursor = jobs[jobs.length - 1].id;
  }
  const sources = await read(async r => {
    const configs = await r.find<FeedSource>('jobFeedSources', {}, 1000);
    const states = new Map((await r.find<SourceState>('jobFeedStates', {}, 1000)).map(s => [s.id, s]));
    return configs.map(s => ({ id: s.id, type: s.type, countryCode: s.countryCode || null, enabled: s.enabled, approved: s.approved,
      lastSuccessAt: states.get(s.id)?.lastSuccessAt ?? null, status: states.get(s.id)?.status ?? 'not_run',
      errorCode: states.get(s.id)?.errorCode ?? null, counts: states.get(s.id)?.counts ?? null }));
  });
  return { generatedAt: now.toISOString(), total, worldwide, unknownGeography, domains, employmentTypes: types, sources,
    credentialsAvailable: { adzuna: !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY), usajobs: !!(process.env.USAJOBS_API_KEY && process.env.USAJOBS_USER_AGENT) },
    countries: countryEntries.map(c => ({ ...c, indexedListings: countryCounts.get(c.name)!, status: countryCounts.get(c.name) ? 'partial_inventory' : 'no_explicit_inventory',
      countryFeeds: sources.filter(s => s.countryCode?.toUpperCase() === c.code).map(s => ({ id: s.id, status: s.status, lastSuccessAt: s.lastSuccessAt, errorCode: s.errorCode })) })),
    notes: ['Counts describe stored live listings, not platform completeness or applicant eligibility.', 'Worldwide jobs are reported separately, not counted as evidence of local jobs in every country.', 'Website reachability from each country is not established by this report.'] };
}


// Store a reproducible measurement after a worker run changes inventory or reports a failure.
export async function saveCoverageAudit() {
  const report = await coverageReport();
  await transaction(r => r.put('jobEngineState', { id: 'coverage-latest', ...report }));
  return report;
}
