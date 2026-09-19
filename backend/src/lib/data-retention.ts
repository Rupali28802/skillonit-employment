import { transaction, type Row } from './store.js';

const number = (name: string, fallback: number) => Number(process.env[name] || fallback);
const retentionPolicy = () => ({ auditRetentionDays: number('AUDIT_RETENTION_DAYS', 365), operationalRetentionDays: number('OPERATIONAL_RETENTION_DAYS', 90), webhookRetentionDays: number('WEBHOOK_EVENT_RETENTION_DAYS', 90), retentionBatchSize: number('RETENTION_BATCH_SIZE', 250) });
const targets = (policy: ReturnType<typeof retentionPolicy>) => [
  { collection: 'auditLogs', days: policy.auditRetentionDays },
  { collection: 'workerRuns', days: policy.operationalRetentionDays },
  { collection: 'jobIngestionEvents', days: policy.operationalRetentionDays },
] as const;

export function retentionExpiry(kind: 'audit' | 'operational' | 'webhook', now = new Date()) {
  const p = retentionPolicy(), days = kind === 'audit' ? p.auditRetentionDays : kind === 'webhook' ? p.webhookRetentionDays : p.operationalRetentionDays;
  return new Date(now.getTime() + days * 86400000);
}

export async function runRetentionMaintenance(now = new Date()) {
  const settings = retentionPolicy();
  return transaction(async r => {
    const result: Record<string, number> = {};
    for (const target of targets(settings)) {
      const cutoff = new Date(now.getTime() - target.days * 86400000).toISOString();
      const rows = await r.find<Row>(target.collection, { createdAt: { $lt: cutoff } }, settings.retentionBatchSize);
      for (const row of rows) await r.remove(target.collection, row.id);
      result[target.collection] = rows.length;
    }
    return result;
  });
}
