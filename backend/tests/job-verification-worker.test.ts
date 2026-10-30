import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobVerificationWorkerName, jobVerificationSchedulerId, jobVerificationWorkerConfig, runJobVerificationTask } from '../src/workers/job-verification-runtime.ts';

test('dedicated verification worker is fail-closed, isolated and bounded', () => {
  assert.equal(jobVerificationWorkerName, 'database-job-verification');
  assert.equal(jobVerificationSchedulerId, 'job-verify');
  assert.throws(() => jobVerificationWorkerConfig({ DATABASE_URL: 'configured', ENABLE_JOB_VERIFICATION: 'false' } as NodeJS.ProcessEnv), /JOB_VERIFICATION_DISABLED/);
  const config = jobVerificationWorkerConfig({ DATABASE_URL: 'configured', ENABLE_JOB_VERIFICATION: 'true', JOB_VERIFICATION_INTERVAL_MS: '600000', JOB_VERIFICATION_BATCH_SIZE: '12' } as NodeJS.ProcessEnv);
  assert.equal(config.every, 600_000);
  assert.equal(config.batchSize, 12);
  assert.throws(() => jobVerificationWorkerConfig({ DATABASE_URL: 'configured', ENABLE_JOB_VERIFICATION: 'true', JOB_VERIFICATION_INTERVAL_MS: '60000' } as NodeJS.ProcessEnv));
});

test('dedicated verification worker rejects every unrelated task before execution', async () => {
  await assert.rejects(runJobVerificationTask('cv-process', {}, 'task-one', 1), /JOB_VERIFICATION_TASK_NOT_ALLOWED/);
  await assert.rejects(runJobVerificationTask('notification-dispatch', {}, 'task-two', 1), /JOB_VERIFICATION_TASK_NOT_ALLOWED/);
});
