import { z } from 'zod';

export const matchingId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
const labels = z.array(z.string().trim().min(1).max(200)).max(50);
export const salaryPeriodSchema = z.enum(['hour', 'month', 'year']);
export const candidateMatchingSchema = z.object({
  occupationIds: z.array(matchingId).max(50).optional(),
  educationLevels: labels.optional(),
  educationFields: labels.optional(),
  authorizedCountries: labels.optional(),
  requiresSponsorship: z.boolean().nullable().optional(),
  locationId: matchingId.optional(),
}).strict();
export const jobMatchingSchema = z.object({
  occupationId: matchingId.optional(), locationId: matchingId.optional(),
  requiredSkills: labels.optional(), requiredEducationLevels: labels.optional(),
  requiredEducationFields: labels.optional(),
  workAuthorizationRequired: z.boolean().optional(), sponsorshipAvailable: z.boolean().optional(),
  salaryPeriod: salaryPeriodSchema.optional(), experienceRequired: z.boolean().optional(),
}).strict();
export type CandidateMatching = z.infer<typeof candidateMatchingSchema>;
export type JobMatching = z.infer<typeof jobMatchingSchema>;

const weight = z.number().finite().min(0).max(100);
export const rankingPolicySchema = z.object({
  version: z.string().regex(/^[a-zA-Z0-9._-]{1,60}$/).default('enterprise-v1'),
  weights: z.object({ skills: weight.default(30), occupation: weight.default(15), experience: weight.default(10),
    education: weight.default(5), location: weight.default(8), salary: weight.default(5), mode: weight.default(5),
    keyword: weight.default(7), semantic: weight.default(10), trust: weight.default(3), freshness: weight.default(2),
  }).strict().default({ skills: 30, occupation: 15, experience: 10, education: 5, location: 8, salary: 5, mode: 5, keyword: 7, semantic: 10, trust: 3, freshness: 2 }),
  maxAgeDays: z.number().int().min(1).max(90).default(90),
  freshnessHalfLifeDays: z.number().min(1).max(90).default(30),
  minimumScore: z.number().min(0).max(100).default(1),
  candidatePool: z.number().int().min(30).max(500).default(200),
  localScanLimit: z.number().int().min(500).max(20000).default(5000),
  requireVerifiedEmail: z.boolean().default(true),
  hardExperience: z.boolean().default(false),
  hardRoles: z.boolean().default(false),
  unknownHardRequirement: z.enum(['review', 'exclude']).default('review'),
  allowKeywordFallback: z.boolean().default(true),
  educationAliases: z.record(z.string().max(100), labels).default({}),
  educationEquivalences: z.record(z.string().max(100), labels).default({}),
}).strict().refine(v => Object.values(v.weights).reduce((a, b) => a + b, 0) > 0, 'Ranking needs a positive weight.');
export type RankingPolicy = z.infer<typeof rankingPolicySchema>;
export const defaultRankingPolicy = () => rankingPolicySchema.parse({});

export const matchingQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(30).default(30),
  offset: z.coerce.number().int().min(0).max(500).default(0),
}).strict();
