import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { profileSchema } from './schemas.js';
import type { Profile } from './domain.js';
import { transaction, configuredPlans } from './store.js';
import { student } from './student-onboarding.js';
import { ApiError, audit } from './security.js';

type Draft = { id: string; userId: string; profile: Profile; revision: number; sourceProfileRevision: number; confirmed: boolean; createdAt: string; versionId?: string };
/** Deterministic text rendering: no inference, enrichment, or generated candidate facts. */
export function renderAts(p: Profile) {
  const sections = [p.name, p.headline, [p.city, p.country].filter(Boolean).join(', ')].filter(Boolean);
  if (p.skills.length) sections.push('Skills\n' + p.skills.join(', '));
  if (p.employmentHistory?.length) sections.push('Work Experience\n' + p.employmentHistory.map(e => [e.title, e.employer, [e.start, e.end].filter(Boolean).join(' – '), e.description].filter(Boolean).join('\n')).join('\n\n'));
  if (p.experience !== null) sections.push('Experience Summary\n' + p.experience + ' years of experience');
  if (p.education) sections.push('Education\n' + p.education);
  return sections.join('\n\n') + '\n';
}
export async function atsCv(userId: string, id: string | undefined, action: 'create' | 'get' | 'edit' | 'confirm' | 'export', input?: unknown) {
  const edit = action === 'edit' ? z.object({ expectedRevision: z.number().int().min(0), profile: profileSchema.partial().omit({ confirmed: true }) }).strict().parse(input) : undefined;
  const confirm = action === 'confirm' ? z.object({ expectedRevision: z.number().int().min(0), confirmed: z.literal(true), name: z.string().trim().min(1).max(100) }).strict().parse(input) : undefined;
  const plans = action === 'confirm' ? await configuredPlans() : [];
  return transaction(async r => {
    const u = await student(r, userId);
    let row: Draft;
    if (action === 'create') {
      if (!u.profile.confirmed) throw new ApiError(409, 'CONFIRMATION_REQUIRED', 'Confirm your profile before generating a CV.');
      if (await r.count('atsCvDrafts', { userId }) >= 20) throw new ApiError(409, 'DRAFT_LIMIT', 'Your CV draft limit has been reached.');
      // Serialize concurrent draft/version reservations with existing CV quota writes.
      await r.put('users', { ...u, cvQuotaRevision: (u.cvQuotaRevision ?? 0) + 1 });
      row = { id: randomUUID(), userId, profile: u.profile, revision: 0, sourceProfileRevision: u.profileRevision ?? 0, confirmed: false, createdAt: new Date().toISOString() };
      await r.put('atsCvDrafts', row);
    } else {
      const found = await r.get<Draft>('atsCvDrafts', id!);
      if (!found || found.userId !== userId) throw new ApiError(404, 'NOT_FOUND', 'CV draft not found.');
      row = found;
    }
    if (edit || confirm) {
      if (row.revision !== (edit ?? confirm)!.expectedRevision) throw new ApiError(409, 'CV_REVIEW_CONFLICT', 'Reload the CV before saving.');
      if (edit) row = { ...row, profile: profileSchema.parse({ ...row.profile, ...edit.profile, confirmed: false }), confirmed: false, versionId: undefined, revision: row.revision + 1 };
      else {
        if (row.confirmed) throw new ApiError(409, 'ALREADY_CONFIRMED', 'This revision is already saved.');
        if (await r.count('cvVersions', { userId }) >= (plans.find(p => p.code === u.plan)?.cvs ?? 1)) throw new ApiError(409, 'ENTITLEMENT_REQUIRED', 'Your CV version limit has been reached.');
        row = { ...row, profile: { ...row.profile, confirmed: true }, confirmed: true, revision: row.revision + 1, versionId: randomUUID() };
        await r.put('cvVersions', { id: row.versionId!, userId, draftId: row.id, name: confirm!.name, profile: row.profile, content: renderAts(row.profile), sourceProfileRevision: row.sourceProfileRevision, source: 'candidate-reviewed', confirmed: true, createdAt: new Date().toISOString() });
        await r.put('users', { ...u, activeCvVersionId: row.versionId!, cvQuotaRevision: (u.cvQuotaRevision ?? 0) + 1 });
        await audit(r, userId, 'ats_cv.confirmed', row.id);
      }
      await r.put('atsCvDrafts', row);
    }
    if (action === 'export') {
      if (!row.confirmed) throw new ApiError(409, 'CONFIRMATION_REQUIRED', 'Review and confirm the CV before export.');
      return { filename: 'resume.txt', contentType: 'text/plain; charset=utf-8', content: renderAts(row.profile), versionId: row.versionId };
    }
    return { ...row, preview: renderAts(row.profile) };
  });
}
