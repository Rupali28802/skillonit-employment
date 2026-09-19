import { validateCvStructure } from './cv-file-validation.js';
import { preserveProfileMedia } from './student-profile.js';
import { bounded, module2Config } from './module2-config.js';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError, audit } from './security.js';
import { read, transaction, configuredPlans } from './store.js';
import { student } from './student-onboarding.js';
import { profileSchema } from './schemas.js';
import type { Profile } from './domain.js';
import type { CvProviders } from './cv-providers.js';
import { extractedDraft } from './cv-draft.js';
import { resolveStudentEntitlements } from './student-entitlements.js';
import { safeLog } from './safe-logger.js';

export const CV_MAX_BYTES = 5 * 1024 * 1024;
export type CvDocument = {
  id: string; userId: string; objectKey: string; filename: string; contentType: string;
  size: number; sha256: string; status: 'uploading' | 'queued' | 'processing' | 'review' | 'confirmed' | 'failed' | 'deleting';
  revision: number; createdAt: string; updatedAt: string; errorCode?: string;
  attempts?: number; scanStatus?: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED'; scannedAt?: string; extractionStatus?: 'PENDING' | 'PARSING' | 'EXTRACTED' | 'FAILED'; parserVersion?: string; expiresAt?: string; activeVersionId?: string;
  draft?: Partial<Profile>; provenance?: Record<string, string>; lease?: string; leaseUntil?: string;
};
export function safeCv(row: CvDocument) {
  const { objectKey: _, sha256: _hash, lease: _lease, leaseUntil: _until, ...safe } = row;
  return safe;
}
async function owned(userId: string, id: string) {
  return read(async r => {
    await student(r, userId); const row = await r.get<CvDocument>('cvDocuments', id);
    if (!row || row.userId !== userId) throw new ApiError(404, 'NOT_FOUND', 'CV not found.');
    return row;
  });
}
export async function listCvs(userId: string) {
  return read(async r => { await student(r, userId); return (await r.find<CvDocument>('cvDocuments', { userId }, 100)).map(safeCv); });
}
export async function getCv(userId: string, id: string) { return safeCv(await owned(userId, id)); }
export async function downloadCv(userId: string, id: string, providers: CvProviders) {
  const row = await owned(userId, id);
  if (row.scanStatus !== 'CLEAN' || !['review', 'confirmed'].includes(row.status)) throw new ApiError(409, 'CV_UNAVAILABLE', 'The CV is not available for download.');
  const bytes = await bounded(providers.storage.get(row.objectKey), 'STORAGE_FAILED');
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new ApiError(503, 'CV_INTEGRITY', 'The CV could not be retrieved safely.');
  return { filename: row.filename, contentType: row.contentType, base64: Buffer.from(bytes).toString('base64') };
}
export async function retryCv(userId: string, id: string, input: unknown) {
  const { expectedRevision } = z.object({ expectedRevision: z.number().int().min(0) }).strict().parse(input);
  return transaction(async r => {
    await student(r, userId); const row = await r.get<CvDocument>('cvDocuments', id);
    if (!row || row.userId !== userId) throw new ApiError(404, 'NOT_FOUND', 'CV not found.');
    if (row.revision !== expectedRevision || row.status !== 'failed' || row.scanStatus === 'INFECTED' || (row.attempts ?? 0) >= module2Config().CV_MAX_ATTEMPTS) throw new ApiError(409, 'CV_RETRY_CONFLICT', 'This CV cannot be retried. Reload its current status.');
    const { errorCode: _, ...base } = row;
    const next: CvDocument = { ...base, status: 'queued', scanStatus: 'PENDING', extractionStatus: 'PENDING', revision: row.revision + 1, updatedAt: new Date().toISOString() };
    await r.put('cvDocuments', next); await audit(r, userId, 'cv.retry_requested', id); return safeCv(next);
  });
}
export async function uploadCv(userId: string, filename: string, contentType: string, bytes: Uint8Array, providers: CvProviders) {
  if (!bytes.length || bytes.length > module2Config().CV_MAX_BYTES) throw new ApiError(413, 'CV_SIZE', 'CV must be between 1 byte and 5 MB.');
  if (!/^[^\\/\x00-\x1f\x7f]{1,180}$/.test(filename) || filename.startsWith('.') || /[:<>|?*]/.test(filename)) throw new ApiError(400, 'CV_FILENAME', 'Use a plain filename.');
  const pdf = contentType === 'application/pdf' && /\.pdf$/i.test(filename) && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-';
  const docx = contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && /\.docx$/i.test(filename) && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  if (!pdf && !docx) throw new ApiError(415, 'CV_TYPE', 'Upload a PDF or DOCX with matching file content.');
  if (!module2Config().CV_ALLOWED_FORMATS.split(',').includes(pdf ? 'pdf' : 'docx')) throw new ApiError(415, 'CV_TYPE', 'This CV format is disabled by policy.');
  await validateCvStructure(bytes, contentType);
  const now = new Date().toISOString(), id = randomUUID();
  const row: CvDocument = { id, userId, objectKey: 'cv/' + userId + '/' + id, filename, contentType, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), status: 'uploading', scanStatus: 'PENDING', extractionStatus: 'PENDING', attempts: 0, expiresAt: new Date(Date.now() + module2Config().CV_RETENTION_DAYS * 86400000).toISOString(), revision: 0, createdAt: now, updatedAt: now };
  const plans = await configuredPlans();
  const reserved = await transaction(async r => {
    const u = await student(r, userId);
    const duplicate = (await r.find<CvDocument>('cvDocuments', { userId, sha256: row.sha256 }, 1))[0];
    if (duplicate) return duplicate;
    const limit = (await resolveStudentEntitlements(r, u, plans)).limits.cvVersions;
    // Serialize reservations on the user, including simultaneous uploads.
    if (await r.count('cvDocuments', { userId }) >= limit) throw new ApiError(409, 'ENTITLEMENT_REQUIRED', 'Your CV document limit has been reached.');
    await r.put('users', { ...u, cvQuotaRevision: (u.cvQuotaRevision ?? 0) + 1 }); await r.put('cvDocuments', row);
    await audit(r, userId, 'cv.upload_reserved', id); return row;
  });
  if (reserved.id !== id) return safeCv(reserved);
  try {
    await bounded(providers.storage.put(row.objectKey, bytes, contentType), 'STORAGE_FAILED');
    return await transaction(async r => {
      const current = await r.get<CvDocument>('cvDocuments', id);
      if (!current || current.status !== 'uploading') throw new Error('Upload state changed');
      const queued = { ...current, status: 'queued' as const, updatedAt: new Date().toISOString() };
      await r.put('cvDocuments', queued); return safeCv(queued);
    });
  } catch {
    // Keep metadata so operators can retry cleanup after storage failures.
    await transaction(async r => { const current = await r.get<CvDocument>('cvDocuments', id); if (current?.status === 'uploading') await r.put('cvDocuments', { ...current, status: 'failed', errorCode: 'STORAGE_FAILED' }); });
    throw new ApiError(503, 'CV_STORAGE_FAILED', 'CV storage failed. Delete this upload before retrying.');
  }
}

/** Worker entry point: bounded batches, persistent queue/leases, no provider work in HTTP. */
export async function processCv(id: string, providers: CvProviders) {
  const lease = randomUUID();
  const row = await transaction(async r => {
    const current = await r.get<CvDocument>('cvDocuments', id);
    if (current?.status === 'processing' && Date.parse(current.leaseUntil || '') < Date.now() && (current.attempts ?? 0) >= module2Config().CV_MAX_ATTEMPTS) {
      const { lease: _, leaseUntil: _until, ...base } = current;
      await r.put('cvDocuments', { ...base, status: 'failed', errorCode: 'RETRY_EXHAUSTED', revision: current.revision + 1, updatedAt: new Date().toISOString() });
      await audit(r, current.userId, 'cv.retry_exhausted', id); return null;
    }
    if (!current || (current.attempts ?? 0) >= module2Config().CV_MAX_ATTEMPTS || !(current.status === 'queued' || (current.status === 'processing' && Date.parse(current.leaseUntil || '') < Date.now()))) return null;
    try { await student(r, current.userId); }
    catch (error) {
      if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) throw error;
      const { lease: _, leaseUntil: _until, ...base } = current;
      await r.put('cvDocuments', { ...base, status: 'failed', errorCode: 'CV_OWNER_UNAVAILABLE', revision: current.revision + 1, updatedAt: new Date().toISOString() });
      await audit(r, current.userId, 'cv.owner_unavailable', id); return null;
    }
    const next: CvDocument = { ...current, status: 'processing', attempts: (current.attempts ?? 0) + 1, scanStatus: 'PENDING', extractionStatus: 'PENDING', lease, leaseUntil: new Date(Date.now() + 300000).toISOString() };
    await r.put('cvDocuments', next); return next;
  });
  if (!row) return false;
  const started = Date.now();
  let scanStatus: CvDocument['scanStatus'] = 'PENDING', extractionStatus: CvDocument['extractionStatus'] = 'PENDING';
  let stage = 'STORAGE';
  let draft: Partial<Profile> | undefined, provenance: Record<string, string> | undefined, errorCode: string | undefined;
  try {
    const bytes = await bounded(providers.storage.get(row.objectKey), 'STORAGE_FAILED');
    if (bytes.length > module2Config().CV_MAX_BYTES || bytes.length !== row.size || createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error();
    stage = 'SCANNER';
    if (await bounded(providers.scanner.scan(bytes, row.contentType), 'SCANNER_FAILED') !== 'clean') { scanStatus = 'INFECTED'; errorCode = 'SCAN_REJECTED'; }
    else {
      scanStatus = 'CLEAN'; stage = 'PARSER'; extractionStatus = 'PARSING';
      await transaction(async r => { const current = await r.get<CvDocument>('cvDocuments', id); if (current?.lease === lease && current.status === 'processing') await r.put('cvDocuments', { ...current, scanStatus: 'CLEAN', scannedAt: new Date().toISOString(), extractionStatus: 'PARSING' }); });
      const extracted = extractedDraft(await bounded(providers.parser.extract(bytes, row.contentType), 'PARSER_FAILED'));
      draft = extracted.profile; provenance = extracted.provenance; extractionStatus = 'EXTRACTED';
    }
  } catch { errorCode = stage + '_FAILED'; if (stage === 'SCANNER') scanStatus = 'FAILED'; if (stage === 'PARSER') extractionStatus = 'FAILED'; }
  await transaction(async r => {
    const current = await r.get<CvDocument>('cvDocuments', id);
    if (!current || current.lease !== lease || current.status !== 'processing') return;
    const { lease: _, leaseUntil: _until, ...base } = current;
    await r.put('cvDocuments', { ...base, scanStatus, extractionStatus, parserVersion: providers.parser.version ?? 'adapter-unspecified', scannedAt: new Date().toISOString(), status: errorCode ? 'failed' : 'review', ...(draft ? { draft, provenance } : {}), ...(errorCode ? { errorCode } : {}), revision: base.revision + 1, updatedAt: new Date().toISOString() });
    await audit(r, row.userId, errorCode ? 'cv.processing_failed' : 'cv.review_ready', id);
  });
  safeLog('info', 'cv.processing_completed', { operation: 'cv-process', durationMs: Date.now() - started, scanStatus, extractionStatus, failed: !!errorCode });
  return true;
}

export async function confirmCv(userId: string, id: string, input: unknown) {
  const data = z.object({ profile: profileSchema.partial().optional(), confirmed: z.literal(true), expectedRevision: z.number().int().min(0), expectedProfileRevision: z.number().int().min(0), name: z.string().trim().min(1).max(100), targetRoles: z.array(z.string().trim().min(1).max(200)).max(50).default([]), summary: z.string().trim().max(6000).default('') }).strict().parse(input);
  if (data.profile?.confirmed === false) throw new ApiError(409, 'CONFIRMATION_REQUIRED', 'Explicitly confirm the reviewed profile.');
  const plans = await configuredPlans();
  return transaction(async r => {
    const u = await student(r, userId), row = await r.get<CvDocument>('cvDocuments', id);
    if (!row || row.userId !== userId) throw new ApiError(404, 'NOT_FOUND', 'CV not found.');
    if (!['review', 'confirmed'].includes(row.status) || row.revision !== data.expectedRevision || (u.profileRevision ?? 0) !== data.expectedProfileRevision)
      throw new ApiError(409, 'CV_REVIEW_CONFLICT', 'Reload the CV review and profile before confirming.');
    if (await r.count('cvVersions', { userId }) >= (await resolveStudentEntitlements(r, u, plans)).limits.cvVersions) throw new ApiError(409, 'ENTITLEMENT_REQUIRED', 'Your CV version limit has been reached.');
    const now = new Date().toISOString();
    const profile = profileSchema.parse({ ...extractedDraft(row.draft ?? {}).profile, ...data.profile, confirmed: true });
    const provenance = { ...row.provenance };
    for (const key of Object.keys(data.profile ?? {})) if (key !== 'confirmed' && JSON.stringify(data.profile?.[key as keyof NonNullable<typeof data.profile>]) !== JSON.stringify(row.draft?.[key as keyof Profile])) provenance[key] = 'Candidate edited';
    const version = { id: randomUUID(), userId, documentId: id, name: data.name, targetRole: data.targetRoles[0] ?? '', targetRoles: data.targetRoles, summary: data.summary, profile, provenance, confirmed: true, source: 'candidate-reviewed', createdAt: now };
    await r.put('cvVersions', version);
    await r.put('users', { ...u, activeCvVersionId: version.id, profileProvenance: Object.fromEntries(Object.keys(profile).filter(k => k !== 'confirmed').map(k => [k, { source: provenance[k] === 'Extracted from CV' ? 'CV_EXTRACTED' : 'MANUAL', status: 'CANDIDATE_CONFIRMED' }])), name: profile.name || u.name, profile: preserveProfileMedia(u.profile, profile), profileRevision: (u.profileRevision ?? 0) + 1, profileUpdatedAt: now, profileConfirmedAt: now });
    await r.put('cvDocuments', { ...row, activeVersionId: version.id, draft: { ...profile, confirmed: false }, provenance, status: 'confirmed', revision: row.revision + 1, updatedAt: now });
    await audit(r, userId, 'cv.confirmed', id); return version;
  });
}

export async function deleteCv(userId: string, id: string, providers: CvProviders, retention = false) {
  const receipt = await read(r => r.get<{ userId: string }>('cvDeletionReceipts', id));
  if (receipt?.userId === userId) { if (!retention) await read(r => student(r, userId)); return { deleted: true }; }
  const row = retention ? await read(r => r.get<CvDocument>('cvDocuments', id)) : await owned(userId, id);
  if (!row || row.userId !== userId) throw new ApiError(404, 'NOT_FOUND', 'CV not found.');
  if (retention && row.status !== 'deleting' && !(Date.parse(row.expiresAt ?? '') < Date.now())) throw new ApiError(409, 'CV_RETENTION', 'The CV is not due for retention deletion.');
  await transaction(async r => {
    if (!retention) await student(r, userId); const current = await r.get<CvDocument>('cvDocuments', id);
    if (!current || current.userId !== userId) throw new ApiError(404, 'NOT_FOUND', 'CV not found.');
    if (retention && current.status !== 'deleting' && !(Date.parse(current.expiresAt ?? '') < Date.now())) throw new ApiError(409, 'CV_RETENTION', 'The CV is not due for retention deletion.');
    if (current.status === 'uploading') throw new ApiError(409, 'CV_BUSY', 'Upload is still in progress.');
    await r.put('cvDocuments', { ...current, status: 'deleting', updatedAt: new Date().toISOString() });
  });
  try { await bounded(providers.storage.delete(row.objectKey), 'STORAGE_DELETE_FAILED'); }
  catch { await transaction(async r => { const current = await r.get<CvDocument>('cvDocuments', id); if (current?.status === 'deleting') { await r.put('cvDocuments', { ...current, errorCode: 'STORAGE_DELETE_FAILED' }); await audit(r, userId, 'cv.delete_failed', id); } }); throw new ApiError(503, 'CV_DELETE_FAILED', 'Private storage deletion failed. Retry deletion.'); }
  await transaction(async r => {
    const current = await r.get<CvDocument>('cvDocuments', id);
    if (!current || current.userId !== userId || current.status !== 'deleting') return;
    for (const v of await r.find<{ id: string }>('cvVersions', { userId, documentId: id }, 100)) await r.remove('cvVersions', v.id);
    const u = await r.get<import('./domain.js').User>('users', userId);
    if (u?.activeCvVersionId && !(await r.get('cvVersions', u.activeCvVersionId))) await r.put('users', { ...u, activeCvVersionId: null });
    await r.put('cvDeletionReceipts', { id, userId, deletedAt: new Date().toISOString(), expiresAtDate: new Date(Date.now() + 2592000000) });
    await r.remove('cvDocuments', id); await audit(r, userId, 'cv.deleted', id);
  });
  return { deleted: true };
}
