import type { Job, Profile, Preferences, User } from './domain.js';
import type { Repository } from './store.js';
import { matchJob, normalize, phrase, unique } from './job-matching.js';
import type { RankingPolicy } from './matching-contracts.js';

export type CatalogEntry = { id: string; slug?: string; active: boolean; displayName: string; aliases?: string[]; localizedNames?: { locale: string; value: string }[]; mappings?: { scheme: string; code: string }[]; ancestorIds?: string[]; parentId?: string | null; relatedRoleIds?: string[]; type?: string; countryCode?: string };
export type MatchingCatalogs = { skills: CatalogEntry[]; occupations: CatalogEntry[]; locations: CatalogEntry[] };
export const emptyCatalogs = (): MatchingCatalogs => ({ skills: [], occupations: [], locations: [] });
export async function loadMatchingCatalogs(r: Repository): Promise<MatchingCatalogs> {
  const result = emptyCatalogs();
  for (const [key, collection] of [['skills', 'skills'], ['occupations', 'occupationFamilies'], ['locations', 'locations']] as const) {
    let after = '';
    for (;;) {
      const rows = await r.scan<CatalogEntry>(collection, { active: true }, after, 500);
      result[key].push(...rows);
      if (result[key].length > 10000) throw new Error('MATCHING_CATALOG_LIMIT');
      if (rows.length < 500) break;
      const next = rows.at(-1)!.id;
      if (next <= after) throw new Error('MATCHING_CATALOG_CURSOR');
      after = next;
    }
  }
  return result;
}
export function resolveEntry(value: string, rows: CatalogEntry[]) {
  const direct = rows.find(row => row.id === value && row.active);
  if (direct) return direct;
  const matches = rows.filter(row => row.active && [row.slug ?? '', row.displayName, ...(row.aliases ?? []), ...(row.localizedNames ?? []).map(item => item.value), ...(row.mappings ?? []).flatMap(item => [item.code, `${item.scheme}:${item.code}`])].some(label => normalize(label) === normalize(value)));
  return matches.length === 1 ? matches[0] : undefined; // Ambiguous aliases never become facts.
}
function canonicalSkills(values: string[], catalogs: MatchingCatalogs) {
  return unique(values.map(value => resolveEntry(value, catalogs.skills)?.displayName ?? value));
}
function within(child: CatalogEntry, parent: CatalogEntry, rows: CatalogEntry[]) {
  const seen = new Set<string>(); let row: CatalogEntry | undefined = child;
  while (row && !seen.has(row.id)) {
    if (row.id === parent.id) return true;
    seen.add(row.id); row = rows.find(item => item.id === row!.parentId && item.active);
  }
  return false;
}
export function locationFit(job: Job, preferences: Preferences, catalogs: MatchingCatalogs): number | null {
  const ids = (preferences as Preferences & { locationIds?: string[] }).locationIds ?? [];
  const jobLocation = job.matching?.locationId ? resolveEntry(job.matching.locationId, catalogs.locations) : undefined;
  const countries = preferences.countries ?? [];
  const regions = [...(preferences.regions ?? []), ...(preferences.indiaStates ?? [])];
  const cities = preferences.cities ?? [];
  if (!ids.length && !countries.length && !regions.length && !cities.length) return null;
  const fits = (value: string, actual: string) => {
    const desired = resolveEntry(value, catalogs.locations);
    if (desired && jobLocation) return within(jobLocation, desired, catalogs.locations);
    if (desired?.countryCode && jobLocation?.countryCode && desired.countryCode !== jobLocation.countryCode) return false;
    return normalize(desired?.displayName ?? value) === normalize(actual);
  };
  // Country and region preferences describe the eligible pool. Cities are a
  // preference inside that pool: city matches receive the full location score,
  // while other jobs in an eligible country remain discoverable and rank after
  // them. A city-only legacy preference remains a strict city filter.
  if (countries.length && !countries.some(value => fits(value, job.country))) return 0;
  if (regions.length && !regions.some(value => fits(value, job.state))) return 0;
  if (ids.length && !ids.some(value => {
      const desired = resolveEntry(value, catalogs.locations);
      if (!desired) return false;
      return jobLocation ? within(jobLocation, desired, catalogs.locations) : fits(value, desired.type === 'country' ? job.country : desired.type === 'city' ? job.city : job.state);
    })) return 0;
  if (cities.length) {
    if (cities.some(value => fits(value, job.city))) return 1;
    return countries.length || regions.length ? 0.75 : 0;
  }
  return 1;
}

/** Sort selected-city results ahead of other eligible country-level results. */
export function locationPreferenceTier(job: Job, preferences: Preferences, catalogs: MatchingCatalogs): number {
  const cities = preferences.cities ?? [];
  if (!cities.length) return 0;
  const jobLocation = job.matching?.locationId ? resolveEntry(job.matching.locationId, catalogs.locations) : undefined;
  return cities.some(value => {
    const desired = resolveEntry(value, catalogs.locations);
    if (desired && jobLocation) return within(jobLocation, desired, catalogs.locations);
    return normalize(desired?.displayName ?? value) === normalize(job.city);
  }) ? 1 : 0;
}
export function occupationFit(job: Job, profile: Profile, preferences: Preferences, catalogs: MatchingCatalogs): number | null {
  const explicit = [...preferences.roles, ...preferences.relatedRoles, ...((preferences as Preferences & { occupationIds?: string[] }).occupationIds ?? [])];
  const targets = explicit.length ? explicit : [...(profile.matching?.occupationIds ?? []), profile.headline, ...(profile.employmentHistory ?? []).map(row => row.title)].filter(Boolean);
  if (!targets.length) return null;
  const jobRole = job.matching?.occupationId ? resolveEntry(job.matching.occupationId, catalogs.occupations) : resolveEntry(job.title, catalogs.occupations);
  return Number(targets.some(value => {
    const desired = resolveEntry(value, catalogs.occupations);
    // Descendants of an explicitly selected family are accepted; unrelated siblings are not added.
    if (jobRole && desired && within(jobRole, desired, catalogs.occupations)) return true;
    return [desired?.displayName ?? value, ...(desired?.aliases ?? [])].some(label => phrase(job.title, label));
  }));
}
export function salaryFit(job: Job, preferences: Preferences): number | null {
  const expected = preferences.salary;
  if (!expected || job.salaryMax <= 0 || job.currency !== expected.currency || !expected.period || !job.matching?.salaryPeriod) return null;
  const period = job.matching.salaryPeriod;
  // Hours cannot be annualized without confirmed contracted hours.
  if ((period === 'hour' || expected.period === 'hour') && period !== expected.period) return null;
  const factor = period === 'month' ? 12 : 1, desiredFactor = expected.period === 'month' ? 12 : 1;
  return Number(job.salaryMax * factor >= expected.min * desiredFactor && job.salaryMin * factor <= expected.max * desiredFactor);
}
function educationFit(required: string[], candidate: string[], policy: RankingPolicy) {
  const canonical = (v: string) => {
    const options = Object.entries(policy.educationAliases).filter(([key, aliases]) => [key, ...aliases].some(a => normalize(a) === normalize(v)));
    return normalize(options.length === 1 ? options[0][0] : v);
  };
  return required.some(req => candidate.some(have => canonical(req) === canonical(have) ||
    (policy.educationEquivalences[canonical(have)] ?? []).some(v => canonical(v) === canonical(req))));
}
export function keywordTerms(profile: Profile, preferences: Preferences, query = '') {
  if (!profile.confirmed) return [];
  // No name, email, education narrative, employer names, raw CV or contact fields.
  return unique([...profile.skills, profile.headline, ...preferences.roles, ...preferences.relatedRoles, query]
    .flatMap(value => normalize(value).match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? [])
    .filter(value => !['the', 'a', 'an', 'and', 'or', 'in', 'for', 'job', 'jobs', 'with'].includes(value))).slice(0, 100);
}
export function keywordScore(job: Job, terms: string[]) {
  if (!terms.length) return 0;
  return terms.reduce((sum, term) => sum + (phrase(job.title, term) || job.skills.some(s => phrase(s, term)) ? 1 :
    phrase(job.category, term) ? 0.7 : phrase(job.description + ' ' + job.requirements, term) ? 0.3 : 0), 0) / terms.length;
}
export function candidateEmbeddingText(profile: Profile) {
  if (!profile.confirmed) return '';
  const scrub = (s: string) => s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '').replace(/https?:\/\/\S+/gi, '').replace(/(?:\+?\d[\d ()-]{7,}\d)/g, '');
  return scrub([profile.headline, ...profile.skills, ...(profile.matching?.educationLevels ?? []), ...(profile.matching?.educationFields ?? []),
    ...(profile.employmentHistory ?? []).map(row => row.title)].filter(Boolean).join('\n')).slice(0, 8000);
}

export function evaluateMatch(job: Job, user: User, profile: Profile, preferences: Preferences, catalogs: MatchingCatalogs,
  policy: RankingPolicy, retrieval: { keyword: number; semantic: number | null }, now = Date.now()) {
  const canonicalProfile = { ...profile, skills: canonicalSkills(profile.skills, catalogs) };
  const canonicalJob = { ...job, skills: canonicalSkills(job.skills, catalogs) };
  const base = matchJob(canonicalJob, canonicalProfile, { ...preferences, countries: [], regions: [], cities: [], indiaStates: [], salary: undefined });
  const failed: string[] = [...base.exclusions], review: string[] = [], unknowns: string[] = [];
  const missingRequirements: string[] = [...base.missingRequirements.filter(v => !v.includes('selected roles'))];
  if (!profile.confirmed) failed.push('PROFILE_UNCONFIRMED');
  if (user.disabled || user.role !== 'student') failed.push('ACCOUNT_INELIGIBLE');
  if (policy.requireVerifiedEmail && !user.verified) failed.push('EMAIL_UNVERIFIED');
  if (job.status !== 'published') failed.push('JOB_UNAVAILABLE');
  if (job.trust !== 'verified') failed.push('JOB_UNVERIFIED');
  const age = (now - Date.parse(job.discoveredAt)) / 86400000;
  if (!Number.isFinite(age) || age < 0 || age > policy.maxAgeDays || !(Date.parse(job.expiresAt) > now)) failed.push('JOB_EXPIRED_OR_STALE');
  const required = canonicalSkills(job.matching?.requiredSkills ?? [], catalogs);
  const absent = required.filter(value => !canonicalProfile.skills.includes(value));
  if (absent.length) { failed.push('REQUIRED_SKILLS_MISSING'); missingRequirements.push(`${absent.length} mandatory skills are not confirmed`); }
  const location = locationFit(job, preferences, catalogs), occupation = occupationFit(job, profile, preferences, catalogs), salary = salaryFit(job, preferences);
  if (location === 0) failed.push('LOCATION_EXCLUDED');
  if (salary === 0) failed.push('SALARY_EXCLUDED');
  if (occupation === 0 && policy.hardRoles) failed.push('OCCUPATION_EXCLUDED');
  const expKnown = profile.experience !== null && Number.isFinite(profile.experience);
  const experience = expKnown ? Number(profile.experience! >= job.experienceMin && profile.experience! <= job.experienceMax) : null;
  if (policy.hardExperience || job.matching?.experienceRequired) {
    if (experience === null) review.push('EXPERIENCE_UNKNOWN'); else if (!experience) failed.push('EXPERIENCE_REQUIRED');
  }
  const ranges = (preferences as Preferences & { experienceYearBands?: { min: number; max: number }[] }).experienceYearBands ?? [];
  const selectedRanges = [...ranges, ...(preferences.experience ? [preferences.experience] : [])];
  if (selectedRanges.length && !selectedRanges.some(b => job.experienceMax >= b.min && job.experienceMin <= b.max)) failed.push('EXPERIENCE_PREFERENCE_EXCLUDED');
  const candidate = profile.matching;
  const educationChecks: boolean[] = [];
  for (const [requiredValues, candidateValues, label] of [
    [job.matching?.requiredEducationLevels, candidate?.educationLevels, 'EDUCATION_LEVEL'],
    [job.matching?.requiredEducationFields, candidate?.educationFields, 'EDUCATION_FIELD'],
  ] as const) if (requiredValues?.length) {
    if (!candidateValues?.length) review.push(label + '_UNKNOWN');
    else { const fits = educationFit(requiredValues, candidateValues, policy); educationChecks.push(fits); if (!fits) failed.push(label + '_REQUIRED'); }
  }
  if (job.matching?.workAuthorizationRequired) {
    if (!candidate?.authorizedCountries) review.push('WORK_AUTHORIZATION_UNKNOWN');
    else if (!candidate.authorizedCountries.some(value => normalize(value) === normalize(job.country)) && job.matching.sponsorshipAvailable !== true) failed.push('WORK_AUTHORIZATION_REQUIRED');
    if (candidate?.requiresSponsorship === true && job.matching.sponsorshipAvailable !== true) failed.push('SPONSORSHIP_UNAVAILABLE');
  }
  const components = {
    skills: canonicalJob.skills.length ? base.breakdown.skills / 40 : null,
    occupation, experience, education: educationChecks.length ? Number(educationChecks.every(Boolean)) : null,
    location, salary, mode: preferences.modes.length ? base.breakdown.mode / 10 : null,
    keyword: retrieval.keyword, semantic: retrieval.semantic,
    trust: Number(job.trust === 'verified'), freshness: Number.isFinite(age) && age >= 0 ? Math.pow(0.5, age / policy.freshnessHalfLifeDays) : 0,
  };
  const explanations = Object.entries(components).map(([factor, value]) => {
    const weight = policy.weights[factor as keyof typeof policy.weights];
    if (value === null) unknowns.push(factor);
    return { factor, status: value === null ? 'UNKNOWN' : value > 0 ? 'MATCH' : 'MISMATCH', value, weight, points: value === null ? 0 : Math.max(0, Math.min(1, value)) * weight };
  });
  const totalWeight = Object.values(policy.weights).reduce((a, b) => a + b, 0);
  const hardStatus = failed.length ? 'INELIGIBLE' : review.length ? 'NEEDS_REVIEW' : 'ELIGIBLE';
  const eligibleForRecommendation = !failed.length && (!review.length || policy.unknownHardRequirement === 'review');
  const relevanceEvidence = (components.skills ?? 0) + (occupation ?? 0) + retrieval.keyword + (retrieval.semantic ?? 0);
  const score = eligibleForRecommendation && relevanceEvidence > 0 ? Math.round(100 * explanations.reduce((sum, row) => sum + row.points, 0) / totalWeight) : 0;
  return {
    ...base, version: 'enterprise-matching-v2', policyVersion: policy.version,
    status: !profile.confirmed ? 'PROFILE_UNCONFIRMED' : eligibleForRecommendation ? 'SCORED' : 'EXCLUDED', score,
    reasons: explanations.filter(row => row.status === 'MATCH').map(row => `${row.factor} match`),
    missingRequirements, unknowns, exclusions: [...new Set(failed)], breakdown: components, explanations,
    hardEligibility: { status: hardStatus, failures: [...new Set(failed)], needsReview: [...new Set(review)], applicationEligibilityEvaluated: false },
    matchedSkills: base.matchedSkills, missingSkills: unique([...base.missingSkills, ...absent]),
  };
}
