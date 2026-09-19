import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { productionCvProviders } from '../lib/cv-production.js';
import { bootstrapIndexes, closeStore, read, transaction } from '../lib/store.js';
import { type Job as DomainJob } from '../lib/domain.js';
import { fingerprint } from '../lib/pipeline.js';
import { fetchJobSource } from '../lib/job-source-strategy.js';
import { runScheduledDiscovery } from '../lib/job-discovery.js';
import { runIngestion } from '../lib/job-ingestion.js';
import { expireJobs } from '../lib/lifecycle.js';
import { runCvBatch, runCvMaintenance } from './cv.js';
import { processDueEmailApplications, scheduleAutomaticApplicationBatch, scheduleAutomaticApplications } from '../lib/application-engine.js';
import { recheckFraud } from '../lib/fraud-detection.js';
import { expireStudentSubscriptions } from '../lib/student-entitlements.js';
import { dispatchNotificationEmails, processNotificationCampaigns } from '../lib/notification-platform.js';
import { recordAnalyticsSnapshot } from '../lib/analytics-platform.js';
import { closeQueueResources, configuredSchedules, executeQueueTask, queueConnection, taskPolicies, type QueueHandler, type QueueTaskName } from '../lib/queue-infrastructure.js';
import { safeLog } from '../lib/safe-logger.js';
import { runRetentionMaintenance } from '../lib/data-retention.js';

const queueName = 'skillonit-operations';
const handlers: Record<QueueTaskName, QueueHandler> = {
  'cv-maintenance': async () => runCvMaintenance(),
  'cv-process': async () => runCvBatch(),
  'application-sender': async (_, context) => processDueEmailApplications(context.taskId),
  'auto-apply-scheduler': async () => scheduleAutomaticApplicationBatch(),
  'auto-apply-user': async data => scheduleAutomaticApplications(data.userId),
  'subscription-expiry': async () => expireStudentSubscriptions(),
  'source-scheduler': async () => runScheduledDiscovery(),
  'source-discovery': async (data, context) => fetchJobSource(data.sourceId, context.taskId),
  'source-fetch': async (data, context) => fetchJobSource(data.sourceId, context.taskId),
  'job-ingestion': async () => runIngestion(),
  'job-verify': async (data, context) => recheckFraud(context.taskId, data.jobId ? { jobId: data.jobId } : {}),
  'fraud-recheck': async (data, context) => recheckFraud(context.taskId, data.jobId ? { jobId: data.jobId } : {}),
  'job-retention': async () => expireJobs(),
  'notification-dispatch': async () => { await processNotificationCampaigns(); await dispatchNotificationEmails(); },
  'job-dedupe': async data => {
    const job = await read(r => r.get<DomainJob>('jobs', data.jobId));
    if (!job) throw new Error('JOB_NOT_FOUND');
    await transaction(r => r.put('jobFingerprints', { id: fingerprint(job), jobId: job.id }));
  },
  'analytics-rollup': async () => recordAnalyticsSnapshot(),
  'data-retention': async () => runRetentionMaintenance(),
};

async function main() {
  const connection = queueConnection() as ConnectionOptions;
  if (process.env.ENABLE_CV_UPLOADS === 'true') await productionCvProviders().check();
  await bootstrapIndexes();
  const queue = new Queue(queueName, { connection });
  for (const schedule of configuredSchedules()) {
    const policy = taskPolicies[schedule.name];
    await queue.upsertJobScheduler(schedule.id, { every: schedule.every }, { name: schedule.name, data: {}, opts: { attempts: policy.attempts, backoff: { type: 'exponential', delay: policy.backoffMs }, removeOnComplete: { count: 500 }, removeOnFail: { count: 2000 } } });
  }
  const worker = new Worker(queueName, async (job: Job) => {
    const name = job.name as QueueTaskName, handler = handlers[name];
    if (!handler) throw new Error('QUEUE_TASK_UNSUPPORTED');
    return executeQueueTask({ id: String(job.id), name, data: job.data, attempt: job.attemptsMade + 1 }, handler);
  }, { connection, concurrency: Math.min(20, Math.max(1, Number(process.env.QUEUE_WORKER_CONCURRENCY || 4) || 4)), limiter: { max: Math.min(1000, Math.max(1, Number(process.env.QUEUE_RATE_LIMIT_PER_MINUTE || 60) || 60)), duration: 60_000 } });
  worker.on('error', () => safeLog('error', 'queue_worker.connection_error'));
  worker.on('failed', job => safeLog('warn', 'queue_worker.task_failed', { task: job?.name || 'unknown', final: !!job && job.attemptsMade >= Number(job.opts.attempts || 1) }));
  safeLog('info', 'queue_worker.started', { schedules: configuredSchedules().length });
  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true;
    try { await closeQueueResources([worker, queue]); await closeStore(); process.exitCode = 0; }
    catch { safeLog('error', 'queue_worker.shutdown_timeout'); process.exitCode = 1; }
  };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}

main().catch(async () => { safeLog('error', 'queue_worker.startup_failed'); await closeStore(); process.exitCode = 1; });
