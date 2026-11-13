import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Job } from '../lib/domain.js';
import { closeStore, read, transaction } from '../lib/store.js';
import { hash, normalize } from './normalize.js';
import { sourceSchema } from './sources.js';

const provider = z.enum(['openjobdata', 'open-jobs']).parse(process.argv[2]);
const snapshot = process.argv[3];
const apply = process.env.APPLY_OPEN_JOB_IMPORT === 'true';
const publish = process.env.PUBLISH_OPEN_JOB_IMPORT === 'true';
const checkpointId = 'bulk-jobs-' + provider;
const day = 86_400_000;
const source = sourceSchema.parse({
  id: provider, type: 'openjobdata', name: provider === 'openjobdata' ? 'OpenJobData' : 'Open Jobs',
  enabled: true, approved: true, publicListing: true, publish, intervalMinutes: 1440,
  policyEvidence: provider === 'openjobdata'
    ? 'https://huggingface.co/datasets/scholarweave/Jobs-Dataset-v2'
    : 'https://github.com/elliottdehn/open-jobs',
});
const rowSchema = z.object({
  id: z.string().min(1).max(2000), title: z.string().min(1), company: z.string().min(1),
  url: z.string().url(), country: z.string().nullish(), city: z.string().nullish(),
  state: z.string().nullish(), mode: z.string().nullish(), type: z.string().nullish(),
  posted: z.string().nullish(), seen: z.string().nullish(),
});
type Row = z.infer<typeof rowSchema>;
type Reference = { id: string; jobId: string; source: string; active: boolean; seen: string };
const stats = { accepted: 0, skipped: 0, closed: 0, checkpoints: 0 };

function mapJob(row: Row) {
  const now = Date.now();
  const seen = Date.parse(row.seen || '');
  // Archived listings are only usable after the crawler has observed them again.
  if (!Number.isFinite(seen) || seen > now + 300_000 || seen < now - 7 * day) return null;
  const mode = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' }[
    (row.mode || '').toLowerCase().replace(/[^a-z]/g, '')
  ] as 'Remote' | 'Hybrid' | 'On-site' | undefined;
  const posted = Date.parse(row.posted || '');
  const job = normalize({
    externalId: row.id, title: row.title, company: row.company, url: row.url,
    description: 'See the employer’s posting for the full job description and requirements.',
    attributionUrl: source.policyEvidence,
    location: [row.city, row.state, row.country].filter(Boolean).join(', '),
    city: row.city || undefined, state: row.state || undefined, country: row.country || undefined,
    mode, employmentType: row.type || undefined,
    postedAt: Number.isFinite(posted) ? new Date(posted).toISOString() : undefined,
  }, source, now);
  job.feed!.lastSeenAt = new Date(seen).toISOString();
  return job;
}

async function persist(jobs: Job[], closures: string[]) {
  if (!apply) return;
  try {
    await persistBatch();
  } catch (error) {
    if ((error as { code?: string }).code !== '57014' || jobs.length + closures.length < 2) throw error;
    const middle = Math.ceil((jobs.length + closures.length) / 2);
    await persist(jobs.slice(0, middle), closures.slice(0, Math.max(0, middle - jobs.length)));
    await persist(jobs.slice(middle), closures.slice(Math.max(0, middle - jobs.length)));
  }

  async function persistBatch() {
  await transaction(async r => {
    let changed = false;
    const jobWrites = new Map<string, Job>();
    const referenceWrites = new Map<string, Reference>();
    const displacedJobs = new Set<string>();
    for (const job of jobs) {
      const id = hash(provider + ':' + job.feed!.externalId);
      const ref = referenceWrites.get(id) ?? await r.get<Reference>('bulkJobReferences', id);
      const existing = jobWrites.get(job.id) ?? await r.get<Job>('jobs', job.id);
      // The existing discovery engine uses the same canonical application URL hash.
      // Keep native jobs authoritative when both providers point to them.
      const managed = existing?.feed && ['openjobdata', 'open-jobs'].includes(existing.feed.sourceId);
      if (!existing || (managed && existing.feed!.sourceId === provider &&
        (existing.status === 'published' || existing.status === 'review' || existing.feed!.closedByEngine) &&
        (existing.feed!.lastSeenAt < job.feed!.lastSeenAt || (existing.status === 'closed' && existing.feed!.lastSeenAt === job.feed!.lastSeenAt)))) {
        if (existing) {
          job.discoveredAt = existing.discoveredAt;
          if (!job.sourcePostedAt) job.expiresAt = existing.expiresAt;
          if (existing.status === 'review') job.status = 'review';
        }
        jobWrites.set(job.id, job);
        changed = true;
      }
      if (!ref?.active || ref.jobId !== job.id || ref.seen !== job.feed!.lastSeenAt) {
        referenceWrites.set(id, { id, source: provider, jobId: job.id, active: true, seen: job.feed!.lastSeenAt });
      }
      if (ref && ref.jobId !== job.id) displacedJobs.add(ref.jobId);
    }
    if (jobWrites.size) await r.putMany('jobs', [...jobWrites.values()]);
    if (referenceWrites.size) await r.putMany('bulkJobReferences', [...referenceWrites.values()]);
    for (const jobId of displacedJobs) await closeUnreferenced(jobId);
    for (const sourceJobId of closures) {
      const id = hash(provider + ':' + sourceJobId);
      const ref = await r.get<Reference>('bulkJobReferences', id);
      if (!ref?.active) continue;
      await r.put('bulkJobReferences', { ...ref, active: false });
      await closeUnreferenced(ref.jobId);
    }

    if (changed) await r.put('jobEngineState', { id: 'feed-version', version: randomUUID(), updatedAt: new Date().toISOString() });

    async function closeUnreferenced(jobId: string) {
      const job = await r.get<Job>('jobs', jobId);
      if (!job?.feed || !['openjobdata', 'open-jobs'].includes(job.feed.sourceId) || !(job.status === 'published' || job.status === 'review')) return;
      if ((await r.find<Reference>('bulkJobReferences', { jobId, active: true, seen: { $gte: new Date(Date.now() - 7 * day).toISOString() } }, 1)).length) return;
      if ((await r.find('jobFeedVariants', { jobId, active: true }, 1)).length) return;
      await r.put('jobs', { ...job, status: 'closed', feed: { ...job.feed, closedByEngine: true } });
      changed = true;
    }
  });
  }
}

async function run() {
  if (apply && !process.env.DATABASE_URL?.trim() && !process.env.MONGODB_URI?.trim()) {
    throw new Error('A persistent database is required for import');
  }
  const cursor = apply ? await read(async r => (await r.get<{ cursor: string }>('jobEngineState', checkpointId))?.cursor || '') : process.env.OPEN_JOB_IMPORT_PREVIEW_CURSOR || '';
  const script = fileURLToPath(new URL('../../scripts/read-open-job-data.py', import.meta.url));
  const args = [script, provider, '--cursor', cursor, ...(snapshot ? ['--snapshot', snapshot] : [])];
  const child = spawn(process.env.OPEN_JOB_IMPORT_PYTHON || 'python', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  const result = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  // Observe failures even if the reader exits before the first row arrives.
  void result.catch(() => undefined);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let jobs: Job[] = [], closures: string[] = [];
  const configuredLimit = process.env.OPEN_JOB_IMPORT_MAX_ROWS;
  const limit = configuredLimit ? z.coerce.number().int().positive().parse(configuredLimit) : apply ? Infinity : 1000;
  try {
    for await (const line of lines) {
      const event = JSON.parse(line);
      if (typeof event.checkpoint === 'string') {
        await persist(jobs, closures);
        jobs = []; closures = [];
        if (apply) await transaction(async r => {
          const old = await r.get<{ cursor: string }>('jobEngineState', checkpointId);
          if (!old || old.cursor < event.checkpoint) await r.put('jobEngineState', {
            id: checkpointId, cursor: event.checkpoint, updatedAt: new Date().toISOString(),
          });
        });
        stats.checkpoints++;
      } else if (typeof event.closed === 'string') {
        if (jobs.length) { await persist(jobs, []); jobs = []; }
        closures.push(event.closed);
        stats.closed++;
      } else {
        if (closures.length) { await persist([], closures); closures = []; }
        const row = rowSchema.safeParse(event);
        let job: Job | null = null;
        if (row.success) {
          try { job = mapJob(row.data); } catch { /* Invalid source record. */ }
        }
        if (job) { jobs.push(job); stats.accepted++; }
        else stats.skipped++;
      }
      if (jobs.length + closures.length >= 50) {
        await persist(jobs, closures);
        jobs = []; closures = [];
      }
      if (stats.accepted + stats.skipped + stats.closed >= limit) {
        await persist(jobs, closures);
        child.kill();
        await result;
        console.log({ provider, dryRun: !apply, limited: true, ...stats });
        return;
      }
    }
    if (await result !== 0) throw new Error('Open jobs reader failed');
    await persist(jobs, closures);
    console.log({ provider, dryRun: !apply, ...stats });
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

try {
  await run();
} finally {
  await closeStore();
}
