import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { User } from './domain.js';
import { ApiError, audit } from './security.js';
import { read, transaction, type Repository, type Row } from './store.js';

const integer = (env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) => {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
};

export function productionPolicy(env = process.env) {
  return {
    backupEnabled: env.BACKUP_ENABLED === 'true',
    backupRpoMinutes: integer(env, 'BACKUP_RPO_MINUTES', 60, 1, 1440),
    backupRtoMinutes: integer(env, 'BACKUP_RTO_MINUTES', 240, 1, 10080),
    backupRetentionDays: integer(env, 'BACKUP_RETENTION_DAYS', 35, 7, 3650),
    restoreDrillMaxAgeDays: integer(env, 'RESTORE_DRILL_MAX_AGE_DAYS', 90, 1, 366),
    auditRetentionDays: integer(env, 'AUDIT_RETENTION_DAYS', 365, 90, 3650),
    operationalRetentionDays: integer(env, 'OPERATIONAL_RETENTION_DAYS', 90, 7, 730),
    webhookRetentionDays: integer(env, 'WEBHOOK_EVENT_RETENTION_DAYS', 90, 7, 730),
    retentionBatchSize: integer(env, 'RETENTION_BATCH_SIZE', 250, 10, 1000),
    shutdownTimeoutMs: integer(env, 'SHUTDOWN_TIMEOUT_MS', 15000, 1000, 60000),
  };
}

const drillSchema = z.object({
  backupCreatedAt: z.iso.datetime(), recoveryPointAt: z.iso.datetime(),
  restoreStartedAt: z.iso.datetime(), restoreCompletedAt: z.iso.datetime(),
  status: z.enum(['passed', 'failed']), notes: z.string().trim().max(500).optional(),
}).strict().superRefine((value, ctx) => {
  const point = Date.parse(value.recoveryPointAt), backup = Date.parse(value.backupCreatedAt);
  const start = Date.parse(value.restoreStartedAt), end = Date.parse(value.restoreCompletedAt);
  if (point > backup || backup > start || start > end || end > Date.now() + 300000)
    ctx.addIssue({ code: 'custom', message: 'Recovery drill timestamps are inconsistent.' });
});

async function requireAdmin(r: Repository, actor: User) {
  const current = await r.get<User>('users', actor.id);
  if (!current || current.disabled || current.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
}

export async function recordRecoveryDrill(actor: User, input: unknown) {
  const value = drillSchema.parse(input), policy = productionPolicy();
  const rpoMinutes = Math.ceil((Date.parse(value.backupCreatedAt) - Date.parse(value.recoveryPointAt)) / 60000);
  const rtoMinutes = Math.ceil((Date.parse(value.restoreCompletedAt) - Date.parse(value.restoreStartedAt)) / 60000);
  return transaction(async r => {
    await requireAdmin(r, actor);
    const row = { id: randomUUID(), ...value, rpoMinutes, rtoMinutes, meetsRpo: rpoMinutes <= policy.backupRpoMinutes, meetsRto: rtoMinutes <= policy.backupRtoMinutes, recordedBy: actor.id, createdAt: new Date().toISOString() };
    await r.put('recoveryDrills', row); await audit(r, actor.id, 'recovery.drill_recorded', row.id); return row;
  });
}

export async function productionReadiness(actor: User) {
  const policy = productionPolicy(), now = Date.now();
  return read(async r => {
    await requireAdmin(r, actor);
    const drills = await r.find<Row>('recoveryDrills', { status: 'passed' }, 100);
    const latest = drills.sort((a, b) => Date.parse(String(b.restoreCompletedAt)) - Date.parse(String(a.restoreCompletedAt)))[0];
    const recent = !!latest && now - Date.parse(String(latest.restoreCompletedAt)) <= policy.restoreDrillMaxAgeDays * 86400000;
    const objectivesMet = !!latest && latest.meetsRpo === true && latest.meetsRto === true;
    const pendingDeadLetters = await r.count('deadLetterJobs', { status: 'pending' });
    const checks = { persistence: true, managedBackups: policy.backupEnabled, recentRestoreDrill: recent, recoveryObjectives: objectivesMet, deadLettersClear: pendingDeadLetters === 0 };
    return { ready: Object.values(checks).every(Boolean), checks, recovery: { rpoMinutes: policy.backupRpoMinutes, rtoMinutes: policy.backupRtoMinutes, backupRetentionDays: policy.backupRetentionDays, latestDrillAt: latest?.restoreCompletedAt ?? null }, pendingDeadLetters };
  });
}
