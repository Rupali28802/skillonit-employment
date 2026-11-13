import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { runRetentionMaintenance } from '../lib/data-retention.js';
import { executeQueueTask, taskPolicies } from '../lib/queue-infrastructure.js';
import { closeStore } from '../lib/store.js';
import { safeLog } from '../lib/observability.js';

try {
  const taskId = randomUUID();
  const policy = taskPolicies['data-retention'];
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      await executeQueueTask(
        { id: taskId, name: 'data-retention', data: {}, attempt },
        async () => { await runRetentionMaintenance(); },
      );
      break;
    } catch (error) {
      if (attempt === policy.attempts) throw error;
      await delay(policy.backoffMs);
    }
  }
  safeLog('info', 'data_retention.completed');
} catch {
  safeLog('error', 'data_retention.failed');
  process.exitCode = 1;
} finally {
  await closeStore();
}
