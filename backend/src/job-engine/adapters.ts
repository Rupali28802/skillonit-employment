import { setTimeout as delay } from 'node:timers/promises';
import type { FeedSource } from './sources.js';
import { joobleDomains, joobleKey } from './jooble-regions.js';
import { reserveJoobleRequest } from './jooble-budget.js';
import { normalizeCountry } from '../lib/countries.js';

export type Candidate = {
  externalId: string; title: string; company: string; url: string; description: string;
  location: string; country?: string; countryCodes?: string[]; category?: string; tags?: string[];
  mode?: 'Remote' | 'Hybrid' | 'On-site'; employmentType?: string;
  postedAt?: string; closesAt?: string; salaryText?: string;
  updatedAt?: string; city?: string; state?: string; skills?: string[];
  salary?: { min?: number; max?: number; currency?: string; period?: string };
  experience?: { min?: number; max?: number; text?: string };
};
export type FeedBatch = { jobs: Candidate[]; complete: boolean; snapshot: boolean; requests: number };
export class FeedError extends Error {
  constructor(public code: string, public retryAfterMs = 0) { super(code); }
}
type Json = Record<string, any>;
const text = (v: unknown) => typeof v === 'string' ? v : '';
const list = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
const iso = (v: unknown) => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const stamp = typeof v === 'number' ? v * 1000 : Date.parse(/T\d\d:\d\d:\d\d$/.test(v) ? v + 'Z' : v);
  return Number.isFinite(stamp) && Math.abs(stamp) <= 8640000000000000 ? new Date(stamp).toISOString() : 'invalid';
};

export async function fetchJson(url: string, extraHeaders: Record<string, string> = {}, body?: Record<string, unknown>): Promise<Json | Json[]> {
  const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000),
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: { Accept: 'application/json', 'User-Agent': 'SkillonIT-JobFeed/1.0', ...extraHeaders } });
  if (!r.ok) {
    const retry = r.headers.get('retry-after') || '';
    const ms = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
    throw new FeedError(`HTTP_${r.status}`, Math.min(86400000, Math.max(0, ms || 0)));
  }
  const reader = r.body?.getReader();
  if (!reader) throw new FeedError('EMPTY_RESPONSE');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 15 * 1024 * 1024) { await reader.cancel(); throw new FeedError('RESPONSE_TOO_LARGE'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new FeedError('INVALID_JSON'); }
}

// Every network origin is fixed here. Source configuration never supplies fetch URLs.
export async function fetchFeed(source: FeedSource, get = fetchJson, pause = delay, reserve = reserveJoobleRequest): Promise<FeedBatch> {
  if (!source.enabled || !source.approved) throw new FeedError('SOURCE_DISABLED');
  const jobs: Candidate[] = []; let requests = 0;
  if (source.type === 'jobtech') {
    let complete = false;
    for (let page = 0; page < source.maxPages; page++) {
      if (page) await pause(2000);
      const query = new URLSearchParams({ limit: '100', offset: String(page * 100), sort: 'pubdate-desc', ...(source.keywords ? { q: source.keywords } : {}) });
      const payload = await get('https://jobsearch.api.jobtechdev.se/search?' + query) as Json; requests++;
      if (!Array.isArray(payload.hits)) throw new FeedError('INVALID_FEED');
      for (const j of payload.hits) {
        if (j.removed === true) continue;
        const address = j.workplace_address || {};
        // The national taxonomy is not ISO. Only the explicit Swedish name is mapped here.
        const country = address.country === 'Sverige' ? 'Sweden' : text(address.country);
        const hours = text(j.working_hours_type?.label);
        jobs.push({ externalId: text(j.id), title: text(j.headline), company: text(j.employer?.name),
          url: text(j.webpage_url), description: text(j.description?.text),
          location: [text(address.city) || text(address.municipality), text(address.region), country].filter(Boolean).join(', '), country,
          // Close at the start of the reported deadline day (UTC), conservatively before a local end-of-day deadline.
          closesAt: /^\d{4}-\d{2}-\d{2}T/.test(text(j.application_deadline)) ? text(j.application_deadline).slice(0, 10) + 'T00:00:00.000Z' : undefined,
          category: text(j.occupation_field?.label), tags: [text(j.occupation?.label), text(j.occupation_group?.label)].filter(Boolean),
          employmentType: [hours === 'Heltid' ? 'Full-time' : hours === 'Deltid' ? 'Part-time' : hours, text(j.employment_type?.label)].filter(Boolean).join(', '),
          // Source timestamps have no timezone contract; retain their text rather than invent an instant.
          ...(j.publication_date ? { description: text(j.description?.text) + '\nSource publication date: ' + text(j.publication_date) } : {}) });
      }
      if (payload.hits.length < 100 || (typeof payload.total?.value === 'number' && (page + 1) * 100 >= payload.total.value)) { complete = true; break; }
    }
    return { jobs, complete, snapshot: false, requests };
  }
  if (source.type === 'reed') {
    const key = process.env.REED_API_KEY;
    if (!key) throw new FeedError('MISSING_REED_CREDENTIALS');
    let complete = false;
    for (let page = 0; page < source.maxPages; page++) {
      if (page) await pause(2000);
      const query = new URLSearchParams({ resultsToTake: '100', resultsToSkip: String(page * 100), ...(source.keywords ? { keywords: source.keywords } : {}) });
      let payload: Json;
      try { payload = await get('https://www.reed.co.uk/api/1.0/search?' + query, { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') }) as Json; }
      catch (error) { if (error instanceof FeedError) throw error; throw new FeedError('REED_REQUEST_FAILED'); }
      requests++;
      if (!Array.isArray(payload.results)) throw new FeedError('INVALID_FEED');
      for (const j of payload.results) jobs.push({ externalId: String(j.jobId ?? ''), title: text(j.jobTitle), company: text(j.employerName),
        url: text(j.jobUrl), description: text(j.jobDescription), location: text(j.locationName) });
      if (payload.results.length < 100 || (typeof payload.totalResults === 'number' && (page + 1) * 100 >= payload.totalResults)) { complete = true; break; }
    }
    return { jobs, complete, snapshot: false, requests };
  }
  if (source.type === 'jooble') {
    const country = source.countryCode || '', domain = joobleDomains[country], key = joobleKey(country);
    if (!domain) throw new FeedError('INVALID_JOOBLE_REGION');
    if (!key) throw new FeedError('MISSING_JOOBLE_CREDENTIALS');
    if (!await reserve(country)) throw new FeedError('JOOBLE_BUDGET_EXHAUSTED');
    let payload: Json;
    try {
      payload = await get(`https://${domain}/api/${encodeURIComponent(key)}`, { 'Content-Type': 'application/json' },
        { keywords: source.keywords || '', location: normalizeCountry(country) || '', page: 1, ResultOnPage: 100 }) as Json;
    } catch (e) {
      // A transport error may contain the credential-bearing URL. Never expose it.
      throw new FeedError(e instanceof FeedError && /^HTTP_\d{3}$/.test(e.code) ? e.code : 'JOOBLE_REQUEST_FAILED', e instanceof FeedError ? e.retryAfterMs : 0);
    }
    if (!payload || !Array.isArray(payload.jobs) || !Number.isSafeInteger(payload.totalCount) || payload.totalCount < 0) throw new FeedError('INVALID_FEED');
    for (const j of payload.jobs) {
      if (!j || typeof j !== 'object') continue;
      jobs.push({ externalId: String(j.id ?? ''), title: text(j.title), company: text(j.company),
        url: text(j.link), description: text(j.snippet), location: text(j.location), salaryText: text(j.salary), employmentType: text(j.type), updatedAt: iso(j.updated) });
      // `updated` is an update timestamp, not a publication date. Regional query != applicant eligibility.
    }
    return { jobs, requests: 1, snapshot: false, complete: payload.totalCount <= payload.jobs.length };
  }
  if (source.type === 'remoteok') {
    const payload = await get('https://remoteok.com/api');
    if (!Array.isArray(payload)) throw new FeedError('INVALID_FEED');
    for (const j of payload) {
      if (!j.id && j.legal) continue; // First feed row contains attribution terms, not a vacancy.
      jobs.push({ externalId: String(j.id ?? ''), title: text(j.position), company: text(j.company),
        url: text(j.url), description: text(j.description), location: text(j.location), tags: list(j.tags), mode: 'Remote', postedAt: iso(j.date) });
    }
    return { jobs, complete: false, snapshot: false, requests: 1 };
  }
  if (source.type === 'himalayas') {
    let complete = false;
    for (let page = 1; page <= source.maxPages; page++) {
      await pause(1500);
      const query = new URLSearchParams({ sort: 'recent', page: String(page),
        ...(source.countryCode ? { country: source.countryCode.toUpperCase(), exclude_worldwide: 'true' } : { worldwide: 'true' }) });
      const payload = await get(`https://himalayas.app/jobs/api/search?${query}`) as Json; requests++;
      if (!Array.isArray(payload.jobs) || !Number.isFinite(payload.totalCount) || !Number.isFinite(payload.limit) || payload.limit < 1) throw new FeedError('INVALID_FEED');
      for (const j of payload.jobs) {
        // Missing geography is unknown. Only an explicit empty restriction array means worldwide.
        const locations = Array.isArray(j.locationRestrictions) ? j.locationRestrictions : undefined;
        const location = locations?.length ? locations.map((c: Json | string) => typeof c === 'string' ? c : text(c.name) || text(c.alpha2)).filter(Boolean).join('; ')
          : locations ? 'Worldwide' : 'Not specified';
        const timezones = list(j.timezoneRestrictions);
        // Live search currently returns seconds although OpenAPI describes milliseconds. Accept both.
        const sourceDate = (value: unknown) => typeof value === 'number' && Math.abs(value) > 100000000000 ? iso(value / 1000) : iso(value);
        jobs.push({ externalId: text(j.guid), title: text(j.title), company: text(j.companyName),
          url: text(j.applicationLink), location,
          countryCodes: locations?.map((c: Json | string) => typeof c === 'string' ? c : text(c.alpha2) || text(c.name)).filter(Boolean),
          description: text(j.description) + `\nReported location eligibility: ${location}` + (timezones.length ? `\nRequired timezone overlap: ${timezones.join(', ')}` : ''),
          category: list(j.parentCategories).join(', '), tags: [...list(j.categories), ...list(j.parentCategories)], mode: 'Remote',
          employmentType: text(j.employmentType), postedAt: sourceDate(j.pubDate), closesAt: sourceDate(j.expiryDate),
          salary: { min: j.minSalary, max: j.maxSalary, currency: text(j.currency), period: text(j.salaryPeriod) },
          salaryText: Number.isFinite(j.minSalary) && Number.isFinite(j.maxSalary) && j.currency
            ? `${text(j.currency)} ${j.minSalary}–${j.maxSalary} ${text(j.salaryPeriod) || 'annual'}` : undefined });
      }
      if (!payload.jobs.length || page * payload.limit >= payload.totalCount) { complete = true; break; }
    }
    return { jobs, complete, snapshot: false, requests };
  }
  if (source.type === 'jobicy') {
    const payload = await get('https://jobicy.com/api/v2/remote-jobs?count=200') as Json;
    if (!Array.isArray(payload.jobs)) throw new FeedError('INVALID_FEED');
    for (const j of payload.jobs) jobs.push({ externalId: String(j.id ?? ''), title: text(j.jobTitle), company: text(j.companyName),
      url: text(j.url), description: text(j.jobDescription), location: text(j.jobGeo), category: list(j.jobIndustry).join(', '),
      tags: list(j.jobIndustry), employmentType: list(j.jobType).join(', '), mode: 'Remote', postedAt: iso(j.pubDate),
      salary: { min: j.salaryMin, max: j.salaryMax, currency: text(j.salaryCurrency), period: text(j.salaryPeriod) },
      salaryText: j.salaryCurrency && j.salaryPeriod && Number.isFinite(j.salaryMin) && Number.isFinite(j.salaryMax)
        ? `${j.salaryCurrency} ${j.salaryMin}–${j.salaryMax} ${j.salaryPeriod}` : undefined });
    // Latest N is a rolling feed, never a full inventory snapshot.
    return { jobs, complete: jobs.length < 200, snapshot: false, requests: 1 };
  }
  if (source.type === 'adzuna') {
    if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) throw new FeedError('MISSING_ADZUNA_CREDENTIALS');
    let complete = false;
    for (let page = 1; page <= source.maxPages; page++) {
      if (page > 1) await pause(2000);
      const query = new URLSearchParams({ app_id: process.env.ADZUNA_APP_ID, app_key: process.env.ADZUNA_APP_KEY,
        results_per_page: '50', sort_by: 'date', max_days_old: '30', ...(source.keywords ? { what: source.keywords } : {}) });
      const payload = await get(`https://api.adzuna.com/v1/api/jobs/${source.countryCode}/search/${page}?${query}`) as Json; requests++;
      if (!Array.isArray(payload.results)) throw new FeedError('INVALID_FEED');
      for (const j of payload.results) jobs.push({ externalId: String(j.id ?? ''), title: text(j.title), company: text(j.company?.display_name),
        url: text(j.redirect_url), description: text(j.description), location: text(j.location?.display_name),
        country: text(j.location?.area?.[0]), category: text(j.category?.label), tags: [text(j.category?.label)].filter(Boolean),
        employmentType: [text(j.contract_time), text(j.contract_type)].filter(Boolean).join(', '), postedAt: iso(j.created) });
      if (payload.results.length < 50 || (typeof payload.count === 'number' && page * 50 >= payload.count)) { complete = true; break; }
    }
    return { jobs, complete, snapshot: false, requests };
  }
  if (source.type === 'usajobs') {
    if (!process.env.USAJOBS_API_KEY || !process.env.USAJOBS_USER_AGENT) throw new FeedError('MISSING_USAJOBS_CREDENTIALS');
    let complete = false;
    for (let page = 1; page <= source.maxPages; page++) {
      if (page > 1) await pause(2000);
      const query = new URLSearchParams({ Page: String(page), ResultsPerPage: '100', DatePosted: '30', SortField: 'opendate', SortDirection: 'desc', Fields: 'Full', ...(source.keywords ? { Keyword: source.keywords } : {}) });
      const payload = await get(`https://data.usajobs.gov/api/search?${query}`, { 'Authorization-Key': process.env.USAJOBS_API_KEY, 'User-Agent': process.env.USAJOBS_USER_AGENT }) as Json; requests++;
      const result = payload.SearchResult;
      if (!Array.isArray(result?.SearchResultItems)) throw new FeedError('INVALID_FEED');
      for (const item of result.SearchResultItems) {
        const j = item.MatchedObjectDescriptor, details = j?.UserArea?.Details;
        const locations: Json[] = Array.isArray(j?.PositionLocation) ? j.PositionLocation : [];
        const pay = j?.PositionRemuneration?.[0];
        const numeric = (v: unknown) => typeof v === 'number' ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined;
        jobs.push({ externalId: String(item.MatchedObjectId ?? ''), title: text(j?.PositionTitle), company: text(j?.OrganizationName),
          url: text(j?.ApplyURI?.[0]) || text(j?.PositionURI), location: text(j?.PositionLocationDisplay),
          city: locations.length === 1 ? text(locations[0].CityName) : undefined,
          state: locations.length === 1 ? text(locations[0].CountrySubDivisionCode) : undefined,
          salaryText: pay ? [pay.MinimumRange, pay.MaximumRange, pay.RateIntervalCode].filter(v => v !== undefined).join(' / ') : undefined,
          salary: pay ? { min: numeric(pay.MinimumRange), max: numeric(pay.MaximumRange), currency: 'USD', period: text(pay.RateIntervalCode) } : undefined,
          country: [...new Set(locations.map(l => text(l.CountryCode)).filter(Boolean))].join('; '),
          category: (j?.JobCategory || []).map((c: Json) => text(c.Name)).join(', '),
          description: [text(details?.JobSummary), text(j?.QualificationSummary), text(details?.WhoMayApply?.Name), text(details?.Requirements)].filter(Boolean).join('\n'),
          employmentType: (j?.PositionSchedule || []).map((c: Json) => text(c.Name)).join(', '),
          postedAt: iso(j?.PublicationStartDate), closesAt: iso(j?.ApplicationCloseDate) });
      }
      if (result.SearchResultItems.length < 100 || page * 100 >= Number(result.SearchResultCountAll)) { complete = true; break; }
    }
    return { jobs, complete, snapshot: false, requests };
  }
  if (source.type === 'arbeitnow' || source.type === 'arbeitnow-uk') {
    const host = source.type === 'arbeitnow' ? 'www.arbeitnow.com' : 'www.arbeitnow.co.uk';
    let complete = false;
    for (let page = 1; page <= source.maxPages; page++) {
      if (page > 1) await pause(2000);
      const payload = await get(`https://${host}/api/job-board-api?page=${page}`) as Json; requests++;
      if (!Array.isArray(payload.data)) throw new FeedError('INVALID_FEED');
      for (const j of payload.data) jobs.push({ externalId: text(j.slug), title: text(j.title), company: text(j.company_name),
        url: text(j.url), description: text(j.description), location: text(j.location),
        // These regional feeds do not explicitly supply each job's country; do not infer it from the feed host.
        tags: list(j.tags), mode: j.remote === true ? 'Remote' : j.remote === false ? 'On-site' : undefined,
        employmentType: list(j.job_types).join(', '), postedAt: iso(j.created_at) });
      if (!payload.links?.next || !payload.data.length) { complete = true; break; }
    }
    return { jobs, complete, snapshot: false, requests };
  }
  if (source.type === 'remotive') {
    const payload = await get('https://remotive.com/api/remote-jobs') as Json;
    if (!Array.isArray(payload.jobs)) throw new FeedError('INVALID_FEED');
    for (const j of payload.jobs) jobs.push({ externalId: String(j.id ?? ''), title: text(j.title), company: text(j.company_name),
      url: text(j.url), description: text(j.description), location: text(j.candidate_required_location),
      category: text(j.category), tags: list(j.tags), mode: 'Remote', employmentType: text(j.job_type),
      postedAt: iso(j.publication_date), salaryText: text(j.salary) });
    return { jobs, complete: !payload['total-job-count'] || payload['total-job-count'] <= jobs.length, snapshot: false, requests: 1 };
  }
  if (!source.board || !/^[a-zA-Z0-9_-]{1,80}$/.test(source.board)) throw new FeedError('INVALID_BOARD');
  const board = encodeURIComponent(source.board);
  if (source.type === 'smartrecruiters') {
    let complete = false;
    for (let page = 0; page < source.maxPages; page++) {
      if (page) await pause(2000);
      const root = 'https://api.smartrecruiters.com/v1/companies/' + board + '/postings';
      const payload = await get(root + '?destination=PUBLIC&limit=20&offset=' + page * 20) as Json; requests++;
      if (!Array.isArray(payload.content) || payload.content.length > 20) throw new FeedError('INVALID_FEED');
      for (const item of payload.content) {
        const id = text(item.id);
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new FeedError('INVALID_POSTING_ID');
        await pause(200);
        // Never follow response-provided ref URLs or include private/internal posting credentials.
        const j = await get(root + '/' + encodeURIComponent(id)) as Json; requests++;
        if (j.active !== true) continue;
        const sections = j.jobAd?.sections || {};
        jobs.push({ externalId: id, title: text(j.name), company: source.company!, url: text(j.postingUrl),
          description: ['jobDescription', 'qualifications', 'additionalInformation'].map(k => text(sections[k]?.text)).filter(Boolean).join('\n'),
          location: [text(j.location?.city), text(j.location?.region), text(j.location?.country)].filter(Boolean).join(', '), country: text(j.location?.country), city: text(j.location?.city), state: text(j.location?.region),
          category: text(j.function?.label), tags: [text(j.industry?.label)].filter(Boolean), employmentType: text(j.typeOfEmployment?.label),
          mode: j.location?.remote === true ? 'Remote' : undefined, postedAt: iso(j.releasedDate) });
      }
      if (payload.content.length < 20 || (typeof payload.totalFound === 'number' && (page + 1) * 20 >= payload.totalFound)) { complete = true; break; }
    }
    return { jobs, complete, snapshot: true, requests };
  }
  if (source.type === 'ashby') {
    const payload = await get(`https://api.ashbyhq.com/posting-api/job-board/${board}`) as Json;
    if (!Array.isArray(payload.jobs)) throw new FeedError('INVALID_FEED');
    for (const j of payload.jobs) {
      if (j.isListed === false) continue;
      jobs.push({ externalId: text(j.id) || text(j.jobUrl), title: text(j.title), company: source.company!,
        url: text(j.jobUrl), description: text(j.descriptionPlain) || text(j.descriptionHtml),
        location: text(j.location), country: text(j.address?.postalAddress?.addressCountry), category: text(j.department),
        city: text(j.address?.postalAddress?.addressLocality), state: text(j.address?.postalAddress?.addressRegion),
        mode: j.isRemote === true ? 'Remote' : ['Remote', 'Hybrid', 'On-site'].includes(j.workplaceType) ? j.workplaceType : undefined,
        employmentType: text(j.employmentType), postedAt: iso(j.publishedAt) });
    }
    return { jobs, complete: true, snapshot: true, requests: 1 };
  }
  if (source.type === 'greenhouse') {
    const payload = await get(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`) as Json;
    if (!Array.isArray(payload.jobs)) throw new FeedError('INVALID_FEED');
    for (const j of payload.jobs) jobs.push({ externalId: String(j.id ?? ''), title: text(j.title), company: source.company!,
      url: text(j.absolute_url), description: text(j.content), location: text(j.location?.name),
      category: text(j.departments?.[0]?.name), updatedAt: iso(j.updated_at) }); // updated_at is not an original posting date.
    return { jobs, complete: true, snapshot: true, requests: 1 };
  }
  let complete = false;
  for (let page = 0; page < source.maxPages; page++) {
    if (page) await pause(2000);
    const payload = await get(`https://api.lever.co/v0/postings/${board}?mode=json&limit=100&skip=${page * 100}`); requests++;
    if (!Array.isArray(payload)) throw new FeedError('INVALID_FEED');
    for (const j of payload) jobs.push({ externalId: text(j.id), title: text(j.text), company: source.company!,
      url: text(j.hostedUrl), description: [text(j.descriptionPlain), ...(Array.isArray(j.lists) ? j.lists.map((x: Json) => `${text(x.text)} ${text(x.content)}`) : []), text(j.additionalPlain)].join('\n'),
      location: text(j.categories?.location), country: text(j.country), category: text(j.categories?.team),
      employmentType: text(j.categories?.commitment), mode: j.workplaceType === 'remote' ? 'Remote' : j.workplaceType === 'hybrid' ? 'Hybrid' : j.workplaceType === 'on-site' ? 'On-site' : undefined });
    if (payload.length < 100) { complete = true; break; }
  }
  return { jobs, complete, snapshot: true, requests };
}
