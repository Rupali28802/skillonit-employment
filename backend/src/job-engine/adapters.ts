import { setTimeout as delay } from 'node:timers/promises';
import type { FeedSource } from './sources.js';

export type Candidate = {
  externalId: string; title: string; company: string; url: string; description: string;
  location: string; country?: string; category?: string; tags?: string[];
  mode?: 'Remote' | 'Hybrid' | 'On-site'; employmentType?: string;
  postedAt?: string; salaryText?: string;
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

export async function fetchJson(url: string): Promise<Json | Json[]> {
  const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', 'User-Agent': 'SkillonIT-JobFeed/1.0' } });
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
export async function fetchFeed(source: FeedSource, get = fetchJson, pause = delay): Promise<FeedBatch> {
  if (!source.enabled || !source.approved) throw new FeedError('SOURCE_DISABLED');
  const jobs: Candidate[] = []; let requests = 0;
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
  if (source.type === 'ashby') {
    const payload = await get(`https://api.ashbyhq.com/posting-api/job-board/${board}`) as Json;
    if (!Array.isArray(payload.jobs)) throw new FeedError('INVALID_FEED');
    for (const j of payload.jobs) {
      if (j.isListed === false) continue;
      jobs.push({ externalId: text(j.id) || text(j.jobUrl), title: text(j.title), company: source.company!,
        url: text(j.jobUrl), description: text(j.descriptionPlain) || text(j.descriptionHtml),
        location: text(j.location), country: text(j.address?.postalAddress?.addressCountry), category: text(j.department),
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
      category: text(j.departments?.[0]?.name) }); // updated_at is not an original posting date.
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
