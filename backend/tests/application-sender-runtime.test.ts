import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationSenderConfig, startApplicationSenderRuntime } from '../src/workers/application-sender-runtime.ts';

test('isolated sender refuses to start unless the application engine is explicitly enabled', () => {
  assert.throws(() => applicationSenderConfig({ ENABLE_APPLICATION_ENGINE: 'inactive' } as NodeJS.ProcessEnv), /APPLICATION_ENGINE_DISABLED/);
  assert.throws(() => applicationSenderConfig({ ENABLE_APPLICATION_ENGINE: 'false' } as NodeJS.ProcessEnv), /APPLICATION_ENGINE_DISABLED/);
  assert.deepEqual(applicationSenderConfig({ ENABLE_APPLICATION_ENGINE: 'true', APPLICATION_SENDER_POLL_MS: '1', APPLICATION_SENDER_BATCH_SIZE: '999' } as NodeJS.ProcessEnv), { pollMs: 5_000, batch: 50, autoApplyScheduler: false, schedulerPollMs: 300_000 });
});

test('Auto Apply scheduling is separately gated and cannot overlap', async () => {
  let calls = 0;
  let finish!: () => void;
  const active = new Promise<void>(resolve => { finish = resolve; });
  const runtime = startApplicationSenderRuntime({
    env: { ENABLE_APPLICATION_ENGINE: 'true', ENABLE_AUTO_APPLY_SCHEDULER: 'true', AUTO_APPLY_SCHEDULER_POLL_MS: '1', APPLICATION_SENDER_POLL_MS: '300000' } as NodeJS.ProcessEnv,
    sender: async () => ({ processed: 0 }),
    scheduler: async () => { calls++; await active; return { users: 1, scheduled: 0, next: null }; },
  });
  await Promise.resolve();
  assert.equal(runtime.config.schedulerPollMs, 60_000);
  assert.equal(calls, 1);
  void runtime.runScheduler();
  assert.equal(calls, 1);
  finish();
  await runtime.close();
});

test('isolated sender prevents overlapping polls and waits for an active poll during shutdown', async () => {
  let calls = 0;
  let finish!: () => void;
  const active = new Promise<void>(resolve => { finish = resolve; });
  const runtime = startApplicationSenderRuntime({
    env: { ENABLE_APPLICATION_ENGINE: 'true', APPLICATION_SENDER_POLL_MS: '300000' } as NodeJS.ProcessEnv,
    owner: 'controlled-test-owner',
    sender: async (owner, batch) => { calls++; assert.equal(owner, 'controlled-test-owner'); assert.equal(batch, 10); await active; return { processed: 0 }; },
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  void runtime.run();
  assert.equal(calls, 1, 'a second poll cannot overlap the active poll');
  const closing = runtime.close();
  let closed = false; void closing.then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  finish(); await closing; assert.equal(closed, true);
});
