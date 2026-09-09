import { z } from 'zod';
import type { User } from './domain.js';
import { ApiError, audit, id } from './security.js';
import { preferencesIn, revokeAutomation } from './student-preferences.js';
export { savePreferences } from './student-preferences.js';
import { read, transaction, type Repository } from './store.js';
import { profileStatus } from './student-profile.js';

export async function student(r: Repository, userId: string) {
  const user = await r.get<User>('users', userId);
  if (!user || user.disabled) throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
  if (user.role !== 'student') throw new ApiError(403, 'FORBIDDEN', 'A student account is required.');
  return user;
}
const labels = ['account', 'basic-profile', 'cv-or-manual', 'extraction-review', 'skills', 'target-roles', 'locations', 'experience', 'salary-work-mode', 'automation-preferences', 'consent', 'mailbox', 'plan'] as const;
export type Onboarding = { id: string; userId: string; revision: number; mode?: 'manual' | 'cv'; currentStep?: typeof labels[number]; mailboxSkipped?: boolean; planReviewed?: boolean; completedAt?: string; updatedAt: string };
type Consent = { id: string; userId: string; purpose: 'profile' | 'automation' | 'mailbox'; granted: boolean; policyVersion: string; updatedAt: string; consentType?: string; version?: string; status?: 'granted' | 'revoked'; grantedAt?: string | null; revokedAt?: string | null; source?: string; context?: string; createdAt?: string };
const purpose = z.enum(['profile', 'automation', 'mailbox']);
const consentContext = { source: z.enum(['onboarding', 'settings', 'api']).default('api'), context: z.enum(['profile_setup', 'automation_preferences', 'mailbox_preferences', 'privacy_settings']).optional() };
const consentRequestSchema = z.union([
  z.object({ purpose, granted: z.boolean(), policyVersion: z.string().trim().min(1).max(100), ...consentContext }).strict(),
  z.object({ consentType: purpose, status: z.enum(['granted', 'revoked']), version: z.string().trim().min(1).max(100), ...consentContext }).strict().transform(({ consentType, status, version, ...rest }) => ({ purpose: consentType, granted: status === 'granted', policyVersion: version, ...rest })),
]);
export async function getConsents(userId: string) {
  return read(async r => {
    await student(r, userId);
    return (await r.find<Consent>('candidateConsents', { userId }, 3)).map(row => ({ ...row, consentType: row.purpose, version: row.policyVersion, status: row.granted ? 'granted' : 'revoked', grantedAt: row.grantedAt ?? null, revokedAt: row.revokedAt ?? null, createdAt: row.createdAt ?? null, source: row.source ?? 'legacy', context: row.context ?? null }));
  });
}
async function consent(r: Repository, userId: string, name: string) {
  return (await r.get<Consent>('candidateConsents', userId + ':' + name))?.granted === true;
}

export async function onboardingState(userId: string) {
  return read(r => onboardingIn(r, userId));
}
async function onboardingIn(r: Repository, userId: string) {
    const u = await student(r, userId);
    const record = await r.get<Onboarding>('studentOnboarding', userId);
    const p = u.profile, prefs = (await preferencesIn(r, u)).value;
    const automation = await r.get<{ preferences: { enabled: boolean } }>('automationPreferences', userId);
    const documents = await r.find<{ status: string }>('cvDocuments', { userId }, 100);
    const confirmedCv = documents.some(row => row.status === 'confirmed');
    const checks = [
      u.verified, p.confirmed,
      record?.mode === 'manual' || (record?.mode === 'cv' && documents.some(row => !['failed', 'deleting', 'uploading'].includes(row.status))),
      p.confirmed && (record?.mode === 'manual' || confirmedCv),
      p.confirmed, prefs.roles.length > 0,
      prefs.countries.length > 0 || (prefs.cities?.length ?? 0) > 0,
      p.confirmed,
      !!prefs.salary && prefs.modes.length > 0,
      automation ? (!automation.preferences.enabled || await consent(r, userId, 'automation')) : !!prefs.automationConstraints && (!prefs.automationConstraints.enabled || await consent(r, userId, 'automation')),
      await consent(r, userId, 'profile'),
      record?.mailboxSkipped === true,
      record?.planReviewed === true,
    ];
    const steps = labels.map((name, i) => ({ number: i + 1, name, complete: !!checks[i], optional: name === 'mailbox' }));
    const required = steps.filter(s => !s.optional);
    const ready = required.every(s => s.complete);
    return { revision: record?.revision ?? 0, mode: record?.mode ?? null, steps,
      currentStep: record?.currentStep ?? required.find(s => !s.complete)?.name ?? 'plan',
      completedSteps: steps.filter(s => s.complete).map(s => s.name),
      onboardingStatus: ready && record?.completedAt ? 'COMPLETED' : record ? 'IN_PROGRESS' : 'NOT_STARTED',
      profileCreationPath: record?.mode === 'cv' ? 'CV' : record?.mode === 'manual' ? 'MANUAL' : null,
      lastUpdated: record?.updatedAt ?? null,
      nextStep: required.find(s => !s.complete)?.number ?? null,
      completeness: Math.round(required.filter(s => s.complete).length / required.length * 100),
      ready, completed: ready && !!record?.completedAt, completedAt: record?.completedAt ?? null,
      profile: profileStatus(u), plan: u.plan, mailbox: { available: false, optional: true, skipped: record?.mailboxSkipped ?? false } };
}

export async function completeOnboarding(userId: string) {
  return transaction(async r => {
    const state = await onboardingIn(r, userId);
    if (!state.ready) throw new ApiError(409, 'ONBOARDING_INCOMPLETE', 'Complete the required profile and onboarding steps.');
    const u = await student(r, userId), old = await r.get<Onboarding>('studentOnboarding', userId);
    if (!old?.completedAt) {
      // Serialize completion with canonical profile/preferences mutations.
      await r.put('users', u);
      const now = new Date().toISOString();
      await r.put('studentOnboarding', { ...old!, id: userId, userId, revision: (old?.revision ?? 0) + 1, completedAt: now, updatedAt: now });
      await audit(r, userId, 'onboarding.completed', userId);
    }
    return onboardingIn(r, userId);
  });
}

export async function saveOnboarding(userId: string, input: unknown) {
  const data = z.object({ mode: z.enum(['manual', 'cv']).optional(), profileCreationPath: z.enum(['CV', 'MANUAL']).optional(), currentStep: z.enum(labels).optional(), mailboxSkipped: z.boolean().optional(), planReviewed: z.boolean().optional(), expectedRevision: z.number().int().min(0).optional() }).strict().parse(input);
  if (data.mode && data.profileCreationPath && data.mode !== data.profileCreationPath.toLowerCase()) throw new ApiError(400, 'ONBOARDING_PATH', 'Conflicting profile paths.');
  await transaction(async r => {
    await student(r, userId);
    const old = await r.get<Onboarding>('studentOnboarding', userId);
    const { expectedRevision: _, profileCreationPath, ...fields } = data;
    const changes = { ...fields, ...(profileCreationPath ? { mode: profileCreationPath.toLowerCase() as 'cv' | 'manual' } : {}) };
    // Identical retries do not advance revision or add duplicate audit events.
    if (old && Object.entries(changes).every(([key, value]) => old[key as keyof Onboarding] === value)) return;
    if (data.expectedRevision !== undefined && data.expectedRevision !== (old?.revision ?? 0))
      throw new ApiError(409, 'ONBOARDING_CONFLICT', 'Reload onboarding before saving.');
    await r.put('studentOnboarding', { ...old, ...changes, id: userId, userId, revision: (old?.revision ?? 0) + 1, updatedAt: new Date().toISOString() });
    if (changes.currentStep && labels.indexOf(changes.currentStep) > labels.indexOf(old?.currentStep ?? 'account')) {
      const state = await onboardingIn(r, userId);
      if (state.steps.slice(0, labels.indexOf(changes.currentStep)).some(step => !step.optional && !step.complete)) throw new ApiError(409, 'ONBOARDING_TRANSITION', 'Complete the preceding required steps before continuing.');
    }
    await audit(r, userId, 'onboarding.updated', userId);
  });
  return onboardingState(userId);
}

export async function saveConsent(userId: string, input: unknown) {
  const data = consentRequestSchema.parse(input);
  return transaction(async r => {
    const u = await student(r, userId);
    const old = await r.get<Consent>('candidateConsents', userId + ':' + data.purpose);
    if (old?.consentType && old.granted === data.granted && old.policyVersion === data.policyVersion && old.source === data.source && old.context === data.context) return old;
    const now = new Date().toISOString();
    const row: Consent = { id: userId + ':' + data.purpose, userId, ...data, consentType: data.purpose, version: data.policyVersion, status: data.granted ? 'granted' : 'revoked', grantedAt: data.granted ? now : old?.grantedAt ?? null, revokedAt: data.granted ? null : now, createdAt: old?.createdAt ?? old?.updatedAt ?? now, updatedAt: now };
    await r.put('candidateConsents', row);
    await r.put('candidateConsentEvents', { ...row, id: id() });
    if (data.purpose === 'automation' && !data.granted) {
      await revokeAutomation(r, u);
    }
    await audit(r, userId, data.granted ? 'consent.granted' : 'consent.revoked', row.id);
    return row;
  });
}
