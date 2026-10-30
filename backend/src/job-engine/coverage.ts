import { read, transaction } from '../lib/store.js';
import type { Job } from '../lib/domain.js';
import { countryEntries } from '../lib/countries.js';
import type { FeedSource } from './sources.js';
import type { SourceState } from './engine.js';
import { indiaRegion, indiaRegions } from './india-regions.js';

type CoverageBuckets = Record<string, number>;

function add(bucket: CoverageBuckets, value: string | null | undefined) {
  const label = value?.trim() || 'Unknown';
  bucket[label] = (bucket[label] || 0) + 1;
}

function ordered(bucket: CoverageBuckets) {
  return Object.entries(bucket)
    .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount || leftName.localeCompare(rightName))
    .map(([name, listings]) => ({ name, listings }));
}
const percent = (part: number, total: number) => total ? Math.round((part / total) * 1000) / 10 : 0;

export async function coverageReport() {
  const countryCounts = new Map(countryEntries.map(c => [c.name, 0]));
  const domains: Record<string, number> = {}, types: Record<string, number> = {};
  let cursor = '', total = 0, worldwide = 0, unknownGeography = 0;
  const completeness = { normalized: 0, skills: 0, experience: 0, salary: 0, city: 0, state: 0, postedAt: 0, updatedAt: 0, sourceExpiry: 0, verified: 0 };
  const now = new Date();
  const india = {
    localListings: 0,
    eligibleListings: 0,
    remoteOrInternationalEligible: 0,
    localWithoutState: 0,
    localWithoutCity: 0,
    states: {} as CoverageBuckets,
    cities: {} as CoverageBuckets,
    industries: {} as CoverageBuckets,
    categories: {} as CoverageBuckets,
    sources: {} as CoverageBuckets,
    freshness: { seenLast24Hours: 0, seenLast7Days: 0, staleOver7Days: 0, unknown: 0 },
  };
  for (;;) {
    const jobs = await read(r => r.scan<Job>('jobs', { status: 'published', sample: { $ne: true },
      expiresAt: { $gt: now.toISOString() } }, cursor, 500));
    if (!jobs.length) break;
    for (const j of jobs) {
      total++; domains[j.category] = (domains[j.category] || 0) + 1; types[j.type] = (types[j.type] || 0) + 1;
      if (j.normalizedFacts) completeness.normalized++;
      if (j.skills.length) completeness.skills++;
      if (j.experienceDisclosed === true) completeness.experience++;
      if (j.salaryDisclosed === true) completeness.salary++;
      if (j.normalizedFacts?.city) completeness.city++;
      if (j.normalizedFacts?.state) completeness.state++;
      if (j.sourcePostedAt) completeness.postedAt++;
      if (j.sourceUpdatedAt) completeness.updatedAt++;
      if (j.sourceExpiresAt) completeness.sourceExpiry++;
      if (j.trust === 'verified') completeness.verified++;
      if (j.country === 'Worldwide') worldwide++;
      const names = [...new Set([j.country, ...(j.eligibleCountries || [])])].filter(c => countryCounts.has(c));
      if (!names.length && j.country !== 'Worldwide') unknownGeography++;
      for (const c of names) countryCounts.set(c, countryCounts.get(c)! + 1);

      const indiaLocal = j.country === 'India';
      const indiaEligible = indiaLocal || (j.eligibleCountries || []).includes('India');
      if (indiaEligible) {
        india.eligibleListings++;
        if (!indiaLocal) india.remoteOrInternationalEligible++;
        add(india.industries, j.normalizedFacts?.sourceCategory || j.category);
        add(india.categories, j.category);
        add(india.sources, j.feed?.sourceId || j.source);

        const seenAt = Date.parse(j.feed?.lastSeenAt || j.sourceUpdatedAt || j.discoveredAt);
        if (!Number.isFinite(seenAt)) india.freshness.unknown++;
        else if (seenAt >= now.getTime() - 86400000) india.freshness.seenLast24Hours++;
        else if (seenAt >= now.getTime() - 7 * 86400000) india.freshness.seenLast7Days++;
        else india.freshness.staleOver7Days++;

        if (indiaLocal) {
          india.localListings++;
          const state = j.normalizedFacts?.state || j.state;
          const city = j.normalizedFacts?.city || j.city;
          if (state && state !== 'Not specified') add(india.states, state); else india.localWithoutState++;
          if (city && city !== 'Not specified') add(india.cities, city); else india.localWithoutCity++;
        }
      }
    }
    cursor = jobs[jobs.length - 1].id;
  }
  const sources = await read(async r => {
    const configs = await r.find<FeedSource>('jobFeedSources', {}, 1000);
    const states = new Map((await r.find<SourceState>('jobFeedStates', {}, 1000)).map(s => [s.id, s]));
    return configs.map(s => ({ id: s.id, type: s.type, countryCode: s.countryCode || null, enabled: s.enabled, approved: s.approved,
      intervalMinutes: s.intervalMinutes, nextRunAt: states.get(s.id)?.nextRunAt ?? null,
      lastSuccessAt: states.get(s.id)?.lastSuccessAt ?? null, status: states.get(s.id)?.status ?? 'not_run',
      errorCode: states.get(s.id)?.errorCode ?? null, counts: states.get(s.id)?.counts ?? null }));
  });
  const directSources = await read(async r => (await r.find<any>('jobSources', {}, 1000)).map(source => ({
    id: source.id, name: source.name || source.id, provider: source.provider || 'legacy', enabled: source.enabled === true,
    complianceStatus: source.compliance?.status || source.status || 'unknown', jurisdictions: Array.isArray(source.compliance?.jurisdictions) ? source.compliance.jurisdictions : [],
    intervalMinutes: source.schedule?.intervalMinutes ?? null, healthStatus: source.health?.status || 'unknown',
    lastSuccessAt: source.health?.lastSuccessAt ?? null, lastFailureAt: source.health?.lastFailureAt ?? null,
    consecutiveFailures: source.health?.consecutiveFailures ?? 0,
  })));
  const approvedEngineSources = sources.filter(source => source.enabled && source.approved);
  const engineFailureCodes: CoverageBuckets = {};
  for (const source of approvedEngineSources) {
    if (source.status === 'failed') add(engineFailureCodes, source.errorCode || 'UNCLASSIFIED');
  }
  const engineSourceHealth = {
    approvedEnabled: approvedEngineSources.length,
    indiaScoped: approvedEngineSources.filter(source => source.countryCode?.toUpperCase() === 'IN').length,
    reportingNormally: approvedEngineSources.filter(source => {
      const lastSuccess = source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : Number.NaN;
      return ['completed', 'partial'].includes(source.status) && Number.isFinite(lastSuccess)
        && now.getTime() - lastSuccess < Math.max(5, source.intervalMinutes) * 120_000;
    }).length,
    partial: approvedEngineSources.filter(source => source.status === 'partial').length,
    failed: approvedEngineSources.filter(source => source.status === 'failed').length,
    failureCodes: ordered(engineFailureCodes),
    staleOrNeverRun: approvedEngineSources.filter(source => {
      const lastSuccess = source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : Number.NaN;
      return !Number.isFinite(lastSuccess) || now.getTime() - lastSuccess >= Math.max(5, source.intervalMinutes) * 120_000;
    }).length,
  };
  const approvedDirectSources = directSources.filter(source => source.enabled && source.complianceStatus === 'approved');
  const directSourceHealth = {
    approvedEnabled: approvedDirectSources.length,
    indiaScoped: approvedDirectSources.filter(source => source.jurisdictions.some((value: string) => value.toLowerCase() === 'india')).length,
    reportingNormally: approvedDirectSources.filter(source => {
      const lastSuccess = source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : Number.NaN;
      return source.healthStatus === 'idle' && Number.isFinite(lastSuccess)
        && now.getTime() - lastSuccess < Math.max(5, source.intervalMinutes ?? 60) * 120_000;
    }).length,
    degraded: approvedDirectSources.filter(source => source.healthStatus === 'degraded').length,
    failed: approvedDirectSources.filter(source => source.healthStatus === 'failed').length,
    staleOrNeverRun: approvedDirectSources.filter(source => {
      const lastSuccess = source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : Number.NaN;
      return !Number.isFinite(lastSuccess) || now.getTime() - lastSuccess >= Math.max(5, source.intervalMinutes ?? 60) * 120_000;
    }).length,
  };
  const coveredIndiaRegions = new Set(Object.keys(india.states).map(indiaRegion).filter((region): region is (typeof indiaRegions)[number] => region !== undefined));
  const indiaLocationQuality = {
    localWithState: india.localListings - india.localWithoutState,
    localWithCity: india.localListings - india.localWithoutCity,
    stateCompletenessPercent: percent(india.localListings - india.localWithoutState, india.localListings),
    cityCompletenessPercent: percent(india.localListings - india.localWithoutCity, india.localListings),
    statesRepresented: Object.keys(india.states).length,
    citiesRepresented: Object.keys(india.cities).length,
    officialRegionsCovered: coveredIndiaRegions.size,
    officialRegionsTotal: indiaRegions.length,
    officialRegionCoveragePercent: percent(coveredIndiaRegions.size, indiaRegions.length),
    unrepresentedRegions: indiaRegions.filter(region => !coveredIndiaRegions.has(region)),
  };
  return { generatedAt: now.toISOString(), total, worldwide, unknownGeography, completeness, domains, employmentTypes: types, sources,
    credentialsAvailable: { adzuna: !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY), usajobs: !!(process.env.USAJOBS_API_KEY && process.env.USAJOBS_USER_AGENT) },
    countries: countryEntries.map(c => ({ ...c, indexedListings: countryCounts.get(c.name)!, status: countryCounts.get(c.name) ? 'partial_inventory' : 'no_explicit_inventory',
      countryFeeds: sources.filter(s => s.countryCode?.toUpperCase() === c.code).map(s => ({ id: s.id, status: s.status, lastSuccessAt: s.lastSuccessAt, errorCode: s.errorCode })) })),
    directSources, india: { ...india, locationQuality: indiaLocationQuality, sourceHealth: { ...directSourceHealth, engine: engineSourceHealth }, states: ordered(india.states), cities: ordered(india.cities), industries: ordered(india.industries), categories: ordered(india.categories), sources: ordered(india.sources) },
    notes: ['Counts describe stored live listings, not platform completeness or applicant eligibility.', 'Worldwide jobs are reported separately, not counted as evidence of local jobs in every country.', 'India local listings are measured separately from remote or international listings whose source reports India eligibility.', 'Website reachability from each country is not established by this report.'] };
}


// Store a reproducible measurement after a worker run changes inventory or reports a failure.
export async function saveCoverageAudit() {
  const report = await coverageReport();
  await transaction(r => r.put('jobEngineState', { id: 'coverage-latest', ...report }));
  return report;
}
