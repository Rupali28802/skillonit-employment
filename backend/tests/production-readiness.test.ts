import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

test('retention, recovery readiness, TTL indexes and graceful shutdown', async () => {
  const old = { ...process.env }, replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replica.getUri(); process.env.MONGODB_DATABASE = 'production_readiness_test';
  process.env.BACKUP_ENABLED = 'true'; process.env.BACKUP_RPO_MINUTES = '60'; process.env.BACKUP_RTO_MINUTES = '240';
  const store = await import('../src/lib/store.js');
  try {
    await store.bootstrapIndexes();
    const admin = { id: 'admin', email: 'admin@example.test', name: 'Admin', role: 'admin' as const, verified: true, disabled: false, passwordHash: 'hash' };
    const oldAt = new Date(Date.now() - 400 * 86400000).toISOString(), freshAt = new Date().toISOString();
    await store.transaction(async r => { await r.put('users', admin); await r.put('auditLogs', { id: 'old', createdAt: oldAt }); await r.put('auditLogs', { id: 'fresh', createdAt: freshAt }); });
    const { runRetentionMaintenance } = await import('../src/lib/data-retention.js');
    const removed = await runRetentionMaintenance(); assert.equal(removed.auditLogs, 1);
    assert.equal(await store.read(r => r.get('auditLogs', 'old')), null); assert.ok(await store.read(r => r.get('auditLogs', 'fresh')));
    const { recordRecoveryDrill, productionReadiness } = await import('../src/lib/production-readiness.js');
    const now = Date.now(); await recordRecoveryDrill(admin, { recoveryPointAt: new Date(now - 30 * 60000).toISOString(), backupCreatedAt: new Date(now - 20 * 60000).toISOString(), restoreStartedAt: new Date(now - 10 * 60000).toISOString(), restoreCompletedAt: new Date(now - 60000).toISOString(), status: 'passed' });
    const readiness = await productionReadiness(admin); assert.equal(readiness.ready, true); assert.equal(readiness.checks.recoveryObjectives, true);
    const { MongoClient } = await import('mongodb'); const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
    for (const name of ['auditLogs', 'workerRuns', 'jobIngestionEvents']) assert.ok((await client.db(process.env.MONGODB_DATABASE).collection(name).indexes()).some(i => i.key.expiresAtDate === 1 && i.expireAfterSeconds === 0));
    await client.close();
    const server = createServer((_req, res) => res.end('ok')).listen(0); await once(server, 'listening'); let dependenciesClosed = false;
    const { closeHttpServer } = await import('../src/lib/graceful-shutdown.js'); await closeHttpServer(server, async () => { dependenciesClosed = true; }, 1000); assert.equal(dependenciesClosed, true);
  } finally { await store.closeStore(); await replica.stop(); process.env = old; }
});

test('production policy rejects unsafe recovery and retention values', async () => {
  const { productionPolicy } = await import('../src/lib/production-readiness.js');
  assert.throws(() => productionPolicy({ BACKUP_RETENTION_DAYS: '1' } as NodeJS.ProcessEnv), /BACKUP_RETENTION_DAYS/);
});
