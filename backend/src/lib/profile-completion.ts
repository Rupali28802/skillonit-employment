import { z } from 'zod';
import type { Profile } from './domain.js';
import { read, transaction } from './store.js';
import { preferenceUser } from './student-preferences.js';
import { audit } from './security.js';
export const completionConfigSchema = z.object({ version: z.string().trim().min(1).max(100), requiredFields: z.array(z.enum(['name', 'headline', 'skills', 'experience', 'education', 'country', 'city', 'employmentHistory'])).min(1).max(8).refine(v => new Set(v).size === v.length) }).strict();
const defaultConfig = completionConfigSchema.parse({ version: '1', requiredFields: ['name', 'headline', 'skills', 'experience', 'education', 'country', 'city'] });
export function calculateCompletion(profile: Profile, input: unknown = defaultConfig) {
  const config = completionConfigSchema.parse(input);
  const completedFields = config.requiredFields.filter(key => {
    if (!profile.confirmed) return false;
    const value = profile[key];
    if (key === 'employmentHistory') return profile.employmentHistory?.some(job => !!job.title.trim() && !!job.employer.trim()) ?? false;
    if (Array.isArray(value)) return value.some(v => typeof v === 'string' && v.trim());
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0;
    return typeof value === 'string' && !!value.trim();
  });
  const missingFields = config.requiredFields.filter(key => !completedFields.includes(key));
  return { fieldReasons: Object.fromEntries(config.requiredFields.map(key => [key, !profile.confirmed ? 'CONFIRMATION_REQUIRED' : completedFields.includes(key) ? 'COMPLETE' : 'MISSING_OR_UNKNOWN'])), percentage: Math.round(completedFields.length / config.requiredFields.length * 100), completedFields, missingFields, ready: missingFields.length === 0, readinessStatus: !profile.confirmed ? 'UNCONFIRMED' : missingFields.length ? 'INCOMPLETE' : 'READY', configurationVersion: config.version };
}
export async function profileCompletion(userId: string) {
  return read(async r => { const u = await preferenceUser(r, userId); const config = await r.get<{ value: unknown }>('systemConfig', 'profile-completion'); return calculateCompletion(u.profile, config?.value ?? defaultConfig); });
}
export async function configureCompletion(actorId: string, input: unknown) {
  const value = completionConfigSchema.parse(input);
  await transaction(async r => { await r.put('systemConfig', { id: 'profile-completion', value }); await audit(r, actorId, 'profile_completion.configured', 'profile-completion'); });
  return value;
}
