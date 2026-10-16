import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { processDueEmailApplications, scheduleAutomaticApplicationBatch } from '../lib/application-engine.js';
import { safeLog } from '../lib/safe-logger.js';

type Sender = (owner: string, batch: number, now: Date) => Promise<{ processed: number }>;
type Scheduler = () => Promise<{ users: number; scheduled: number; next: string | null }>;

export function applicationSenderConfig(env = process.env) {
  if (env.ENABLE_APPLICATION_ENGINE !== 'true') throw new Error('APPLICATION_ENGINE_DISABLED');
  const pollMs = Math.min(300_000, Math.max(5_000, Number(env.APPLICATION_SENDER_POLL_MS || 60_000) || 60_000));
  const batch = Math.min(50, Math.max(1, Number(env.APPLICATION_SENDER_BATCH_SIZE || 10) || 10));
  const autoApplyScheduler = env.ENABLE_AUTO_APPLY_SCHEDULER === 'true';
  const schedulerPollMs = Math.min(3_600_000, Math.max(60_000, Number(env.AUTO_APPLY_SCHEDULER_POLL_MS || 300_000) || 300_000));
  return { pollMs, batch, autoApplyScheduler, schedulerPollMs };
}

export function startApplicationSenderRuntime(options: {
  env?: NodeJS.ProcessEnv;
  sender?: Sender;
  scheduler?: Scheduler;
  owner?: string;
  now?: () => Date;
} = {}) {
  const config = applicationSenderConfig(options.env);
  const owner = options.owner ?? `email-sender:${hostname()}:${process.pid}:${randomUUID()}`;
  const now = options.now ?? (() => new Date());
  const sender = options.sender ?? ((workerOwner, batch, at) => processDueEmailApplications(workerOwner, batch, at, undefined, ['email']));
  const scheduler = options.scheduler ?? (() => scheduleAutomaticApplicationBatch());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let schedulerTimer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let schedulerRunning: Promise<void> | undefined;
  let closing = false;

  const schedule = () => {
    if (!closing) timer = setTimeout(() => void run(), config.pollMs);
  };
  const run = () => {
    if (closing || running) return running ?? Promise.resolve();
    running = sender(owner, config.batch, now()).then(result => {
      safeLog('info', 'application_sender.poll_completed', { processed: result.processed });
    }).catch(() => {
      safeLog('error', 'application_sender.poll_failed');
    }).finally(() => {
      running = undefined;
      schedule();
    });
    return running;
  };
  const scheduleAutoApply = () => {
    if (!closing && config.autoApplyScheduler) schedulerTimer = setTimeout(() => void runScheduler(), config.schedulerPollMs);
  };
  const runScheduler = () => {
    if (closing || !config.autoApplyScheduler || schedulerRunning) return schedulerRunning ?? Promise.resolve();
    schedulerRunning = scheduler().then(result => {
      safeLog('info', 'auto_apply_scheduler.poll_completed', { users: result.users, scheduled: result.scheduled });
    }).catch(() => {
      safeLog('error', 'auto_apply_scheduler.poll_failed');
    }).finally(() => {
      schedulerRunning = undefined;
      scheduleAutoApply();
    });
    return schedulerRunning;
  };
  const close = async () => {
    closing = true;
    if (timer) clearTimeout(timer);
    if (schedulerTimer) clearTimeout(schedulerTimer);
    await Promise.all([running, schedulerRunning]);
  };

  void run();
  if (config.autoApplyScheduler) void runScheduler();
  return { close, run, runScheduler, owner, config };
}
