import { z } from 'zod';
import { preferencesSchema } from './schemas.js';
import { read, transaction, type Repository } from './store.js';
import { ApiError, audit } from './security.js';
import type { User } from './domain.js';
import { module2Config } from './module2-config.js';

const ids = z.array(z.string().trim().min(1).max(200)).max(100);
const modes = z.array(z.enum(['Remote', 'Hybrid', 'On-site'])).max(3);
// Zod defaults also run inside optional properties. PATCH-like PUT must retain
// omitted stored values, so only explicitly supplied keys participate in merging.
function provided<T extends object>(input: unknown, parsed: T): T {
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(input as object, key))) as T;
}
async function validateProductionLabels(r: Repository, patch: Record<string, unknown>) {
  if (process.env.NODE_ENV !== 'production') return;
  const collections: Record<string, string> = { roles: 'occupationFamilies', relatedRoles: 'occupationFamilies', skills: 'skills', countries: 'locations', regions: 'locations', indiaStates: 'locations', cities: 'locations' };
  for (const [field, collection] of Object.entries(collections)) for (const value of (patch[field] ?? []) as string[]) {
    const entry = await r.get<{ active: boolean; type?: string; countryCode?: string }>(collection, value) ?? (await r.find<{ active: boolean; type?: string; countryCode?: string }>(collection, { displayName: value, active: true }, 1))[0];
    if (!entry?.active || (field === 'countries' && entry.type !== 'country') || (field === 'cities' && entry.type !== 'city') || (field === 'regions' && !['region', 'state', 'province', 'union_territory'].includes(entry.type ?? '')) || (field === 'indiaStates' && (entry.countryCode !== 'IN' || !['state', 'union_territory'].includes(entry.type ?? '')))) throw new ApiError(400, 'PREFERENCE_REFERENCE', 'Select an active catalog entry.');
  }
}
export const automationSchema = z.object({
  enabled: z.boolean().default(false), dailyCap: z.number().int().min(0).max(100).default(5),
  allowedRoleFamilies: ids.default([]), excludedRoles: ids.default([]), allowedLocations: ids.default([]), excludedLocations: ids.default([]),
  minimumSalary: z.object({ amount: z.number().min(0), currency: z.string().regex(/^[A-Z]{3}$/) }).nullable().default(null),
  workModes: modes.default([]), employmentTypes: ids.default([]), paused: z.boolean().default(true),
  schedule: z.object({
    timeZone: z.string().max(100).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, 'Invalid time zone.'),
    days: z.array(z.number().int().min(0).max(6)).max(7).refine(v => new Set(v).size === v.length),
    start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  }).strict().refine(v => v.end > v.start, 'Schedule must end after start.').nullable().default(null),
}).strict();
export type AutomationPreferences = z.infer<typeof automationSchema>;
export const fullPreferencesSchema = preferencesSchema.extend({
  occupationIds: ids.default([]), locationIds: ids.default([]), skillIds: ids.default([]),
  skills: ids.default([]), regions: ids.default([]), indiaStates: ids.default([]), cities: ids.default([]),
  industries: ids.default([]), employmentTypes: ids.default([]),
  experienceYearBands: z.array(z.object({ min: z.number().min(0).max(70), max: z.number().min(0).max(70) }).strict().refine(v => v.max >= v.min)).max(20).default([]),
  companyPreferences: z.object({ preferred: ids, excluded: ids }).strict().default({ preferred: [], excluded: [] }),
});
type PreferenceRecord = { id: string; userId: string; revision: number; preferences: z.infer<typeof fullPreferencesSchema>; createdAt: string; updatedAt: string };
type AutomationRecord = { id: string; userId: string; revision: number; preferences: AutomationPreferences; createdAt: string; updatedAt: string };
const applicationExecutionAvailable = () => process.env.ENABLE_APPLICATION_ENGINE === 'true';
export async function preferenceUser(r: Repository, userId: string) {
  const u = await r.get<User>('users', userId);
  if (!u || u.disabled) throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
  if (u.role !== 'student') throw new ApiError(403, 'FORBIDDEN', 'A student account is required.');
  return u;
}
export async function preferencesIn(r: Repository, u: User) {
  const row = await r.get<PreferenceRecord>('studentPreferences', u.id);
  return { row, value: fullPreferencesSchema.parse(row?.preferences ?? u.preferences) };
}
export async function getPreferences(userId: string) {
  return read(async r => { const u = await preferenceUser(r, userId); const { row, value } = await preferencesIn(r, u); return { ...value, revision: row?.revision ?? 0 }; });
}
export async function savePreferences(userId: string, input: unknown) {
  const { expectedRevision, consentAt: _, ...patch } = provided(input, fullPreferencesSchema.partial().extend({ expectedRevision: z.number().int().min(0).optional() }).strict().parse(input));
  if (patch.automation) throw new ApiError(503, 'AUTOMATION_UNAVAILABLE', 'Automatic application execution is not available.');
  return transaction(async r => {
    const u = await preferenceUser(r, userId), { row, value } = await preferencesIn(r, u);
    const preferences = fullPreferencesSchema.parse({ ...value, ...patch, automation: false });
    await validateProductionLabels(r, patch);
    if (row && JSON.stringify(preferences) === JSON.stringify(value)) return { ...value, revision: row.revision };
    if (expectedRevision !== undefined && expectedRevision !== (row?.revision ?? 0)) throw new ApiError(409, 'PREFERENCES_CONFLICT', 'Reload preferences before saving.');
    for (const [collection, keys] of [['occupationFamilies', preferences.occupationIds], ['locations', preferences.locationIds], ['skills', preferences.skillIds]] as const) for (const key of keys) if (!(await r.get<{ active: boolean }>(collection, key))?.active) throw new ApiError(400, 'PREFERENCE_REFERENCE', 'Select an active catalog entry.');
    if (preferences.dailyCap > module2Config().AUTOMATION_MAX_DAILY_CAP) throw new ApiError(400, 'DAILY_CAP', 'Daily cap exceeds configured policy.');
    if (preferences.automationConstraints?.enabled && !(await r.get<{ granted: boolean }>('candidateConsents', userId + ':automation'))?.granted) throw new ApiError(409, 'CONSENT_REQUIRED', 'Explicit automation consent is required.');
    const now = new Date().toISOString();
    const next: PreferenceRecord = { id: userId, userId, preferences, revision: (row?.revision ?? 0) + 1, createdAt: row?.createdAt ?? now, updatedAt: now };
    await r.put('studentPreferences', next);
    // Transactional compatibility projection for existing matching/auth consumers.
    await r.put('users', { ...u, preferences });
    await audit(r, userId, 'preferences.updated', userId);
    return { ...preferences, revision: next.revision };
  });
}
export async function getAutomation(userId: string) {
  return read(async r => { await preferenceUser(r, userId); const row = await r.get<AutomationRecord>('automationPreferences', userId); return { ...automationSchema.parse(row?.preferences ?? {}), revision: row?.revision ?? 0, executionAvailable: applicationExecutionAvailable() }; });
}
export async function saveAutomation(userId: string, input: unknown) {
  const { expectedRevision, ...patch } = provided(input, automationSchema.partial().extend({ expectedRevision: z.number().int().min(0).optional() }).strict().parse(input));
  return transaction(async r => {
    const u = await preferenceUser(r, userId), row = await r.get<AutomationRecord>('automationPreferences', userId);
    const preferences = automationSchema.parse({ ...row?.preferences, ...patch });
    if (row && JSON.stringify(preferences) === JSON.stringify(row.preferences)) return { ...preferences, revision: row.revision, executionAvailable: applicationExecutionAvailable() };
    if (expectedRevision !== undefined && expectedRevision !== (row?.revision ?? 0)) throw new ApiError(409, 'PREFERENCES_CONFLICT', 'Reload automation preferences before saving.');
    if (preferences.dailyCap > module2Config().AUTOMATION_MAX_DAILY_CAP) throw new ApiError(400, 'DAILY_CAP', 'Daily cap exceeds configured policy.');
    for (const [collection, keys] of [['occupationFamilies', preferences.allowedRoleFamilies], ['locations', [...preferences.allowedLocations, ...preferences.excludedLocations]]] as const) {
      for (const key of keys) if (!(await r.get<{ active: boolean }>(collection, key))?.active) throw new ApiError(400, 'PREFERENCE_REFERENCE', 'Select an active catalog entry.');
    }
    if (preferences.enabled && !(await r.get<{ granted: boolean }>('candidateConsents', userId + ':automation'))?.granted) throw new ApiError(409, 'CONSENT_REQUIRED', 'Explicit automation consent is required.');
    if (preferences.enabled) {
      const mailbox = await r.get<{ status: string; email: string; scopes: string[] }>('mailboxConnections', userId);
      if (!mailbox || mailbox.status !== 'connected' || mailbox.email !== u.email.toLowerCase() || mailbox.scopes.length !== 1 || mailbox.scopes[0] !== 'https://www.googleapis.com/auth/gmail.send')
        throw new ApiError(409, 'MAILBOX_REQUIRED', 'Connect your Gmail account first to enable automatic applications.');
    }
    const now = new Date().toISOString();
    const next: AutomationRecord = { id: userId, userId, preferences, revision: (row?.revision ?? 0) + 1, createdAt: row?.createdAt ?? now, updatedAt: now };
    // Synchronizes with consent revocation and preference writes even on concurrent requests.
    await r.put('users', { ...u, preferences: { ...u.preferences, automation: false } });
    await r.put('automationPreferences', next); await audit(r, userId, 'automation.updated', userId);
    return { ...preferences, revision: next.revision, executionAvailable: applicationExecutionAvailable() };
  });
}
export async function revokeAutomation(r: Repository, u: User) {
  const row = await r.get<AutomationRecord>('automationPreferences', u.id);
  if (row) await r.put('automationPreferences', { ...row, preferences: { ...row.preferences, enabled: false, paused: true }, revision: row.revision + 1, updatedAt: new Date().toISOString() });
  const { row: prefsRow, value } = await preferencesIn(r, u);
  const preferences = { ...value, automation: false, ...(value.automationConstraints ? { automationConstraints: { ...value.automationConstraints, enabled: false } } : {}) };
  await r.put('users', { ...u, preferences });
  if (prefsRow) await r.put('studentPreferences', { ...prefsRow, preferences, revision: prefsRow.revision + 1, updatedAt: new Date().toISOString() });
  await audit(r, u.id, 'automation.revoked', u.id);
}
