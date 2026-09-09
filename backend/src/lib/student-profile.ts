import { z } from 'zod';
import type { Profile, User } from './domain.js';
import { profileSchema } from './schemas.js';
import { ApiError, audit } from './security.js';
import { read, transaction } from './store.js';

const updateSchema = profileSchema.extend({
  expectedRevision: z.number().int().min(0).optional(),
});

function requireStudent(user: User | null): User {
  if (!user || user.disabled)
    throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
  if (user.role !== 'student')
    throw new ApiError(403, 'FORBIDDEN', 'A student account is required.');
  return user;
}

export function profileStatus(user: User) {
  const p = user.profile;
  const fields = {
    name: !!p.name.trim(), headline: !!p.headline.trim(),
    skills: p.skills.some(skill => !!skill.trim()),
    // Zero is valid for students entering the workforce.
    experience: p.experience !== null && Number.isFinite(p.experience) && p.experience >= 0,
    education: !!p.education.trim(), country: !!p.country.trim(), city: !!p.city.trim(),
  };
  const missingFields = Object.entries(fields).filter(([, complete]) => !complete).map(([field]) => field);
  return {
    revision: user.profileRevision ?? 0,
    updatedAt: user.profileUpdatedAt ?? null,
    confirmedAt: user.profileConfirmedAt ?? null,
    confirmed: p.confirmed,
    completeness: Math.round((Object.keys(fields).length - missingFields.length) / Object.keys(fields).length * 100),
    missingFields,
  };
}

export async function getStudentProfileStatus(userId: string) {
  return read(async r => profileStatus(requireStudent(await r.get<User>('users', userId))));
}

export async function updateStudentProfile(userId: string, input: unknown): Promise<Profile> {
  const { expectedRevision, ...profile } = updateSchema.parse(input);
  return transaction(async r => {
    const latest = requireStudent(await r.get<User>('users', userId));
    const revision = latest.profileRevision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== revision)
      throw new ApiError(409, 'PROFILE_CONFLICT', 'Your profile changed. Reload it before saving again.');
    const now = new Date().toISOString();
    const updated: User = {
      ...latest, profile, name: profile.name || latest.name, profileRevision: revision + 1,
      profileUpdatedAt: now,
      profileProvenance: Object.fromEntries(Object.keys(profile).filter(k => k !== 'confirmed').map(key => [key, { source: 'MANUAL', status: profile.confirmed ? 'CANDIDATE_CONFIRMED' : 'UNCONFIRMED' }])),
    };
    if (profile.confirmed) updated.profileConfirmedAt = now;
    else delete updated.profileConfirmedAt;
    await r.put('users', updated);
    // No profile text, education, skills or CV contents enter the audit trail.
    await audit(r, userId, 'profile.updated', userId);
    return profile;
  });
}
