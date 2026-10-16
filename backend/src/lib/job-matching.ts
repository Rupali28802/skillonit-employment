import type { Job, Profile, Preferences, User } from './domain.js';
import type { Repository } from './store.js';
import { suggestRolesFromSkills } from './role-suggestions.js';

export const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const unique = (values: string[]) => [...new Set(values.map(normalize).filter(Boolean))];
const includes = (values: string[] | undefined, value: string) => unique(values ?? []).includes(normalize(value));
export const phrase = (text: string, value: string) => {
  const needle = normalize(value);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalize(text));
};

/** Deterministic evidence score, not a probability of hiring or application eligibility. */
export function matchJob(job: Job, profile: Profile, preferences: Preferences) {
  const reasons: string[] = [], missingRequirements: string[] = [], unknowns: string[] = [], exclusions: string[] = [];
  const required = unique(job.skills);
  const candidate = new Set(profile.confirmed ? unique(profile.skills) : []);
  const matchedSkills = required.filter(skill => candidate.has(skill));
  const missingSkills = profile.confirmed ? required.filter(skill => !candidate.has(skill)) : [];
  const breakdown = { skills: 0, role: 0, experience: 0, location: 0, mode: 0 };
  if (!profile.confirmed) unknowns.push('Confirm your profile or CV draft before matching.');
  else {
    if (required.length) {
      breakdown.skills = matchedSkills.length / required.length * 40;
      if (matchedSkills.length) reasons.push(`${matchedSkills.length} matching skills`);
      if (missingSkills.length) missingRequirements.push(`${missingSkills.length} listed skills are not in your confirmed profile`);
    } else unknowns.push('Job skills are not specified');
    const roles = unique([...preferences.roles, ...preferences.relatedRoles]);
    // A headline/history is evidence of a role, not an invented candidate preference.
    const profileRoles = [profile.headline, ...(profile.employmentHistory ?? []).map(row => row.title)].filter(Boolean);
    if ((roles.length ? roles : profileRoles).some(role => phrase(job.title, role))) {
      breakdown.role = 25; reasons.push(roles.length ? 'Target or related role' : 'Confirmed profile role fits');
    } else if (roles.length) missingRequirements.push('Job title does not match your selected roles');
    else unknowns.push('No matching confirmed role or target role');
    if (profile.experience === null) unknowns.push('Candidate experience is unknown');
    else if (!Number.isFinite(job.experienceMin) || !Number.isFinite(job.experienceMax)) unknowns.push('Job experience is unknown');
    else if (profile.experience >= job.experienceMin && profile.experience <= job.experienceMax) {
      breakdown.experience = 15; reasons.push('Experience fits');
    } else missingRequirements.push('Experience is outside the listed range');
    const explicitLocationChecks = [
      [preferences.countries, job.country], [preferences.cities, job.city],
      [preferences.regions, job.state], [preferences.indiaStates, job.state],
    ] as const;
    const selected = explicitLocationChecks.filter(([values]) => values?.length);
    let usedProfileLocation = false;
    if (!selected.length && (profile.country || profile.city)) {
      usedProfileLocation = true;
      const eligible = unique([job.country, job.city, job.state, ...(job.eligibleCountries ?? [])]);
      const candidateLocations = unique([profile.country, profile.city].filter(Boolean));
      if (candidateLocations.some(value => eligible.includes(value))) {
        breakdown.location = 10;
        reasons.push('Location fits');
      } else exclusions.push('Outside confirmed profile location');
    }
    if (!selected.length && !usedProfileLocation) unknowns.push('Location preference is not specified');
    else if (selected.every(([values, value]) => includes(values, value))) {
      breakdown.location = 10; reasons.push('Location fits');
    } else exclusions.push('Outside selected locations');
    if (!preferences.modes.length) unknowns.push('Work arrangement preference is not specified');
    else if (includes(preferences.modes, job.mode)) { breakdown.mode = 10; reasons.push('Work arrangement fits'); }
    else exclusions.push('Outside selected work arrangements');
  }
  if (preferences.exclusions.some(value => phrase(job.title, value) || phrase(job.company, value))) exclusions.push('Matches an excluded keyword');
  if (includes(preferences.companyPreferences?.excluded, job.company)) exclusions.push('Company is excluded');
  if (preferences.employmentTypes?.length) {
    if (includes(preferences.employmentTypes, job.type)) reasons.push('Employment type fits');
    else exclusions.push('Outside selected employment types');
  }
  if (preferences.industries?.length) {
    if (includes(preferences.industries, job.category)) reasons.push('Industry fits');
    else exclusions.push('Outside selected industries');
  }
  if (preferences.salary) {
    if (normalize(job.currency) !== normalize(preferences.salary.currency) || job.salaryMax <= 0) unknowns.push('Salary cannot be compared with your preference');
    else if (job.salaryMax < preferences.salary.min || job.salaryMin > preferences.salary.max) exclusions.push('Outside selected salary range');
    else reasons.push('Listed salary overlaps your preference');
  }
  return {
    version: 'confirmed-profile-v1',
    status: !profile.confirmed ? 'PROFILE_UNCONFIRMED' : exclusions.length ? 'EXCLUDED' : 'SCORED',
    score: !profile.confirmed || exclusions.length ? 0 : Math.min(100, Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0))),
    reasons, matchedSkills, missingSkills, missingRequirements, unknowns, exclusions, breakdown,
  };
}

/** Resolve managed preference IDs server-side; extraction drafts are never read. */
export async function matchingInputs(r: Repository, user: User) {
  const preferences = structuredClone(user.preferences);
  const extra = preferences as Preferences & { occupationIds?: string[]; locationIds?: string[] };
  type Entry = { active: boolean; displayName: string; type?: string; countryCode?: string };
  for (const field of ['roles', 'relatedRoles', 'countries', 'regions', 'indiaStates', 'cities'] as const) {
    const collection = ['roles', 'relatedRoles'].includes(field) ? 'occupationFamilies' : 'locations';
    if (preferences[field]) preferences[field] = await Promise.all(preferences[field]!.map(async value => {
      const entry = await r.get<Entry>(collection, value);
      return entry?.active ? entry.displayName : value;
    }));
  }
  for (const id of extra.occupationIds ?? []) {
    const entry = await r.get<Entry>('occupationFamilies', id);
    preferences.roles.push(entry?.active ? entry.displayName : id);
  }
  for (const id of extra.locationIds ?? []) {
    const entry = await r.get<Entry>('locations', id);
    const field = entry?.type === 'country' ? 'countries' : entry?.type === 'city' ? 'cities' : 'regions';
    preferences[field] = [...(preferences[field] ?? []), entry?.active ? entry.displayName : id];
  }
  const profile = structuredClone(user.profile);
  // Preserve legacy manually confirmed profiles, but never use explicitly unconfirmed fields.
  for (const field of ['skills', 'experience', 'headline', 'employmentHistory', 'education', 'matching'] as const) {
    if (user.profileProvenance?.[field] && user.profileProvenance[field].status !== 'CANDIDATE_CONFIRMED') {
      if (field === 'skills') profile.skills = [];
      else if (field === 'experience') profile.experience = null;
      else if (field === 'headline') profile.headline = '';
      else if (field === 'education') profile.education = '';
      else if (field === 'matching') delete profile.matching;
      else profile.employmentHistory = [];
    }
  }
  if (profile.confirmed) {
    const suggested = suggestRolesFromSkills(profile.skills);
    preferences.relatedRoles = [...new Set([...preferences.relatedRoles, ...suggested])];
  }
  return { profile, preferences };
}

export function rankJobs(jobs: Job[], profile: Profile, preferences: Preferences, now = Date.now()) {
  return jobs.filter(job => job.status === 'published' && job.trust === 'verified' &&
    Date.parse(job.discoveredAt) <= now && Date.parse(job.discoveredAt) >= now - 90 * 86400000 && Date.parse(job.expiresAt) > now)
    .map(job => ({ job, match: matchJob(job, profile, preferences) }))
    .filter(row => row.match.status === 'SCORED' && row.match.score > 0)
    .sort((a, b) => b.match.score - a.match.score || Date.parse(b.job.discoveredAt) - Date.parse(a.job.discoveredAt) || a.job.id.localeCompare(b.job.id));
}
