import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Job } from '../lib/domain.js';
import { closeStore, read, transaction } from '../lib/store.js';
import { canonicalUrl, normalize } from './normalize.js';
import type { FeedSource } from './sources.js';

type Posting = { source: string; source_posting_id: string; posting_url?: { value?: string }; attribution?: { required?: boolean } };
type Listing = { job_id: string; employer_name?: { value?: string }; postings?: Posting[] };
type BoardJob = { id: number; title: string; absolute_url: string; location?: { name?: string } };
type Checkpoint = { id: string; cursor: string | null; downloaded: number; published: number };

const source: FeedSource = {
  id: 'headcount-labs-global', type: 'headcount-labs', name: 'Headcount Labs',
  enabled: true, approved: true, publicListing: true, publish: true,
  policyEvidence: 'https://headcountlabs.com/license/', intervalMinutes: 60, maxPages: 4,
};
const checkpointId = 'headcount-labs-greenhouse-' + new Date().toISOString().slice(0, 7);
const boards = new Map<string, Map<number, BoardJob>>();

async function loadBoard(board: string) {
  const cached = boards.get(board);
  if (cached) return cached;
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`, {
    signal: AbortSignal.timeout(12_000), redirect: 'error',
  });
  if (response.status === 404) return new Map<number, BoardJob>();
  if (!response.ok) throw Error(`Greenhouse HTTP ${response.status}`);
  const body = await response.json() as { jobs: BoardJob[] };
  const jobs = new Map(body.jobs.map(job => [job.id, job]));
  boards.set(board, jobs);
  return jobs;
}

async function verify(listing: Listing) {
  for (const posting of listing.postings ?? []) {
    if (posting.source !== 'greenhouse' || posting.attribution?.required) continue;
    const match = posting.posting_url?.value?.match(/^https:\/\/(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)(?:[?#]|$)/i);
    if (!match || match[2] !== posting.source_posting_id) continue;
    const board = await loadBoard(match[1]);
    const active = board.get(Number(match[2]));
    if (!active || !listing.employer_name?.value || canonicalUrl(active.absolute_url) !== canonicalUrl(posting.posting_url!.value!)) continue;
    const now = Date.now();
    return normalize({
      externalId: listing.job_id, title: active.title, company: listing.employer_name.value,
      url: active.absolute_url, location: active.location?.name || 'Not specified',
      closesAt: new Date(now + 86_400_000).toISOString(),
      description: 'Apply on the employer’s job board. Job data: Headcount Labs, ODbL 1.0.',
      attributionUrl: source.policyEvidence,
    }, source, now);
  }
}

try {
  const key = process.env.HEADCOUNT_LABS_API_KEY?.trim();
  const limit = Number(process.argv[2]);
  if (!key || !Number.isInteger(limit) || limit < 1 || limit > 100_000) throw Error('Set the API key and a record limit from 1 to 100000');
  let checkpoint = await read(r => r.get<Checkpoint>('jobEngineState', checkpointId));
  if (!checkpoint || checkpoint.cursor) {
    let downloaded = checkpoint?.downloaded ?? 0;
    while (downloaded < limit) {
      const params = new URLSearchParams({ source: 'greenhouse', currentness: 'current', limit: String(Math.min(100, limit - downloaded)), fields: 'job_id,employer_name,postings' });
      if (checkpoint?.cursor) params.set('cursor', checkpoint.cursor);
      const response = await fetch('https://api.headcountlabs.com/v1/jobs?' + params, {
        headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(60_000), redirect: 'error',
      });
      if (!response.ok) throw Error(`Headcount Labs HTTP ${response.status}`);
      const page = await response.json() as { data: Listing[]; next_cursor: string | null };
      if (page.next_cursor && page.next_cursor === checkpoint?.cursor) throw Error('Headcount Labs repeated its cursor');
      const candidates = new Map<string, Job>();
      for (const listing of page.data) {
        try {
          const job = await verify(listing);
          if (job?.status === 'published') candidates.set(job.id, job);
        } catch {
          // An unavailable employer board supplies no evidence for publication.
        }
      }
      downloaded += page.data.length;
      const published = await transaction(async r => {
        let inserted = 0;
        for (const job of candidates.values()) {
          if (await r.get<Job>('jobs', job.id)) continue;
          await r.put('jobs', job);
          inserted++;
        }
        if (inserted) await r.put('jobEngineState', { id: 'feed-version', version: randomUUID(), updatedAt: new Date().toISOString() });
        const next = { id: checkpointId, cursor: page.next_cursor, downloaded, published: (checkpoint?.published ?? 0) + inserted };
        await r.put('jobEngineState', next);
        return next;
      });
      checkpoint = published;
      console.log(JSON.stringify({ downloaded, published: checkpoint.published, verifiedInPage: candidates.size }));
      if (!page.next_cursor || !page.data.length) break;
      await delay(1_000);
    }
  }
} finally {
  await closeStore();
}
