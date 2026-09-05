import { Worker } from 'bullmq';
import { transaction, read } from '../lib/store';
import { type Job, isRecent } from '../lib/domain';
import {
  GreenhouseAdapter,
  fingerprint,
  type SourcePolicy,
} from '../lib/pipeline';
import { randomUUID } from 'node:crypto';
if (!process.env.REDIS_URL || !process.env.MONGODB_URI)
  throw Error('Workers require REDIS_URL and MONGODB_URI.');
const redis = new URL(process.env.REDIS_URL);
const connection = {
  host: redis.hostname,
  port: Number(redis.port) || 6379,
  username: redis.username || undefined,
  password: redis.password || undefined,
  tls: redis.protocol === 'rediss:' ? {} : undefined,
};
const worker = new Worker(
  'skillonit-operations',
  async (task) => {
    const started = new Date().toISOString();
    if (task.name === 'source-discovery') {
      const policy = await read((r) =>
        r.get<SourcePolicy>('jobSources', String(task.data.sourceId)),
      );
      if (!policy) throw Error('Source policy not found');
      const jobs = await new GreenhouseAdapter().discover(policy);
      await transaction(async (r) => {
        for (const job of jobs) {
          if (await r.get('jobs', job.id!)) continue;
          await r.put('jobSourceVariants', {
            id: job.id!,
            sourceId: policy.id,
            normalized: job,
            status: 'needs_normalization',
            discoveredAt: started,
          });
        }
      });
    } else if (task.name === 'job-retention') {
      const jobs = await read((r) =>
        r.find<Job>('jobs', { status: 'published' }, 1000),
      );
      await transaction(async (r) => {
        for (const job of jobs)
          if (!isRecent(job)) await r.put('jobs', { ...job, status: 'closed' });
      });
    } else if (task.name === 'job-dedupe') {
      const job = await read((r) =>
        r.get<Job>('jobs', String(task.data.jobId)),
      );
      if (!job) throw Error('Job not found');
      await transaction((r) =>
        r.put('jobFingerprints', { id: fingerprint(job), jobId: job.id }),
      );
    } else throw Error('Worker capability not enabled: ' + task.name);
    await transaction((r) =>
      r.put('workerRuns', {
        id: randomUUID(),
        taskId: task.id,
        worker: task.name,
        status: 'completed',
        startedAt: started,
        finishedAt: new Date().toISOString(),
      }),
    );
  },
  { connection, concurrency: 2, limiter: { max: 10, duration: 60000 } },
);
worker.on('failed', async (task) => {
  await transaction((r) =>
    r.put('workerRuns', {
      id: randomUUID(),
      taskId: task?.id,
      worker: task?.name,
      status: 'failed',
      createdAt: new Date().toISOString(),
    }),
  );
});
process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
