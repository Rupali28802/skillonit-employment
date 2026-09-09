import type { Profile } from './domain.js';
import { profileSchema } from './schemas.js';

export const emptyProfile = (): Profile => ({ name: '', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false });
export function extractedDraft(input: unknown) {
  const extracted = profileSchema.partial().parse(input);
  const { confirmed: _, ...facts } = extracted;
  const profile = { ...emptyProfile(), ...facts, confirmed: false };
  const provenance = Object.fromEntries(Object.keys(profile).filter(k => k !== 'confirmed').map(key => {
    const value = facts[key as keyof typeof facts];
    const present = value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
    return [key, present ? 'Extracted from CV' : 'Unknown'];
  }));
  return { profile, provenance };
}
