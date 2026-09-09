import { productionCvProviders } from '../lib/cv-production.js';
import { Worker, Queue } from 'bullmq';
import { transaction, read } from '../lib/store.js';
import { type Job } from '../lib/domain.js';
import {
  GreenhouseAdapter,
  fingerprint,
  type SourcePolicy,
} from '../lib/pipeline.js';
import { randomUUID } from 'node:crypto';
import { expireJobs } from '../lib/lifecycle.js';
import { runCvBatch, runCvMaintenance } from './cv.js';
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
if (process.env.ENABLE_CV_UPLOADS === 'true') {
  try {
    await productionCvProviders().check();
    const queue = new Queue('skillonit-operations', { connection });
    await queue.upsertJobScheduler('cv-process', { every: 60000 }, { name: 'cv-process', data: {} });
    await queue.upsertJobScheduler('cv-maintenance', { every: 3600000 }, { name: 'cv-maintenance', data: {} });
    await queue.close();
  } catch { console.error('CV worker configuration failed; provider details withheld.'); process.exit(1); }
}
const worker = new Worker(
  'skillonit-operations',
  async (task) => {
    const started = new Date().toISOString();
    if (task.name === 'cv-maintenance') {
      await runCvMaintenance();
    } else if (task.name === 'cv-process') {
      await runCvBatch();
    } else if (task.name === 'source-discovery') {
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
      await expireJobs();
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
