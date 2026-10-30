import { productionCvProviders } from '../lib/cv-production.js';
import { bootstrapIndexes, closeStore, read, transaction } from '../lib/store.js';
import { type Job as DomainJob } from '../lib/domain.js';
import { fingerprint } from '../lib/pipeline.js';
import { fetchJobSource } from '../lib/job-source-strategy.js';
import { runScheduledDiscovery } from '../lib/job-discovery.js';
import { runIngestionWithCoverageAudit } from '../lib/job-ingestion.js';
import { expireJobs } from '../lib/lifecycle.js';
import { runCvBatch, runCvMaintenance } from './cv.js';
import { processDueEmailApplications, scheduleAutomaticApplicationBatch, scheduleAutomaticApplications } from '../lib/application-engine.js';
import { recheckFraud } from '../lib/fraud-detection.js';
import { verifyJobs } from '../lib/job-verification.js';
import { expireStudentSubscriptions } from '../lib/student-entitlements.js';
import { dispatchNotificationEmails, processNotificationCampaigns } from '../lib/notification-platform.js';
import { recordAnalyticsSnapshot } from '../lib/analytics-platform.js';
import { configuredSchedules, executeQueueTask, taskPolicies, type QueueHandler, type QueueTaskName } from '../lib/queue-infrastructure.js';
import { safeLog } from '../lib/safe-logger.js';
import { runRetentionMaintenance } from '../lib/data-retention.js';

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
  'job-ingestion': async () => runIngestionWithCoverageAudit(),
  'job-verify': async (data, context) => verifyJobs(context.taskId, data.jobId ? { jobId: data.jobId } : {}),
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
  if (process.env.ENABLE_CV_UPLOADS === 'true') await productionCvProviders().check();
  await bootstrapIndexes();
  const running = new Set<QueueTaskName>();
  const run = async (name: QueueTaskName, attempt = 1): Promise<void> => {
    if (running.has(name)) return;
    running.add(name);
    try {
      await executeQueueTask({ id: `${name}:${Date.now()}`, name, data: {}, attempt }, handlers[name]);
    } catch {
      if (attempt < taskPolicies[name].attempts) setTimeout(() => { void run(name, attempt + 1); }, taskPolicies[name].backoffMs);
      else safeLog('warn', 'worker.task_failed', { task: name });
    } finally { running.delete(name); }
  };
  const timers = configuredSchedules().map(schedule => {
    void run(schedule.name);
    return setInterval(() => { void run(schedule.name); }, schedule.every);
  });
  safeLog('info', 'worker.started', { schedules: timers.length });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    timers.forEach(clearInterval);
    await closeStore().catch(() => {});
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

main().catch(async () => { safeLog('error', 'worker.startup_failed'); await closeStore(); process.exitCode = 1; });
