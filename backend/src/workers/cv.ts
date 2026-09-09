import { configuredCvProviders } from '../lib/cv-providers.js';
import { processCv, deleteCv, type CvDocument } from '../lib/cv-service.js';
import { read, transaction } from '../lib/store.js';
import { audit } from '../lib/security.js';

/** Run from the worker scheduler. Returns safely when adapters are not configured. */
export async function runCvBatch() {
  const providers = configuredCvProviders();
  if (process.env.ENABLE_CV_UPLOADS !== 'true' || !providers) return { available: false, processed: 0 };
  const queued = await read(r => r.find<CvDocument>('cvDocuments', { status: 'queued' }, 10));
  const expired = await read(r => r.find<CvDocument>('cvDocuments', { status: 'processing', leaseUntil: { $lt: new Date().toISOString() } }, 10));
  let processed = 0;
  for (const row of [...queued, ...expired]) if (await processCv(row.id, providers)) processed++;
  return { available: true, processed };
}

/** Bounded recovery/retention sweep. Failed external deletions remain retryable. */
export async function runCvMaintenance(providers = configuredCvProviders()) {
  if (!providers) return { available: false, deleted: 0, failed: 0 };
  const now = new Date().toISOString();
  const stalled = await read(r => r.find<CvDocument>('cvDocuments', { status: 'uploading', updatedAt: { $lt: new Date(Date.now() - 3600000).toISOString() } }, 20));
  for (const row of stalled) await transaction(async r => { const current = await r.get<CvDocument>('cvDocuments', row.id); if (current?.status === 'uploading' && current.updatedAt === row.updatedAt) { await r.put('cvDocuments', { ...current, status: 'failed', errorCode: 'UPLOAD_INTERRUPTED', expiresAt: now }); await audit(r, row.userId, 'cv.upload_interrupted', row.id); } });
  const pending = await read(r => r.find<CvDocument>('cvDocuments', { status: 'deleting' }, 20));
  const expired = await read(r => r.find<CvDocument>('cvDocuments', { expiresAt: { $lt: now } }, 20));
  let deleted = 0, failed = 0;
  for (const row of new Map([...pending, ...expired].map(r => [r.id, r])).values()) {
    try { await deleteCv(row.userId, row.id, providers, true); deleted++; } catch { failed++; }
  }
  return { available: true, deleted, failed };
}
