import { z } from 'zod';
import { candidateMatchingSchema, jobMatchingSchema, salaryPeriodSchema } from './matching-contracts.js';
const text = z.string().trim().min(1).max(200);
const list = z.array(text).max(50);
export const registerSchema = z.object({
  name: text,
  email: z.email().toLowerCase(),
  password: z.string().min(12).max(128),
  role: z.enum(['student', 'employer']).default('student'),
});
export const loginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1).max(128),
});
export const profileSchema = z.object({
  name: z.string().trim().max(200),
  headline: z.string().max(200),
  skills: list,
  experience: z.number().min(0).max(70).nullable(),
  education: z.string().max(3000),
  country: z.string().trim().max(200),
  city: z.string().trim().max(200),
  confirmed: z.boolean(),
  matching: candidateMatchingSchema.optional(),
  employmentHistory: z.array(z.object({
    title: z.string().trim().max(200), employer: z.string().trim().max(200),
    start: z.string().regex(/^(?:|\d{4}(?:-(?:0[1-9]|1[0-2]))?)$/),
    end: z.string().regex(/^(?:|Present|\d{4}(?:-(?:0[1-9]|1[0-2]))?)$/),
    description: z.string().trim().max(3000),
  }).refine(row => !row.start || !row.end || row.end === 'Present' || (row.end.length === 4 ? row.end + '-12' : row.end) >= (row.start.length === 4 ? row.start + '-01' : row.start), 'Employment end precedes start.')).max(30).optional(),
  contactInfo: z.string().trim().max(500).optional(),
  region: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(200).optional(),
  targetRole: z.string().trim().max(200).optional(),
  certifications: list.optional(),
  projects: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  professionalLinks: z.array(z.url().refine(value => new URL(value).protocol === 'https:', 'Professional links must use HTTPS.')).max(20).optional(),
  languages: list.optional(),
  availability: z.string().trim().max(300).optional(),
  relocation: z.string().trim().max(300).optional(),
});
export const preferencesSchema = z.object({
  roles: list,
  relatedRoles: list,
  countries: list,
  modes: z.array(z.enum(['Remote', 'Hybrid', 'On-site'])),
  exclusions: list,
  automation: z.boolean(),
  dailyCap: z.number().int().min(0).max(100),
  consentAt: z.string().optional(),
  skills: list.optional(),
  experience: z.object({ min: z.number().min(0).max(70), max: z.number().min(0).max(70) }).refine(v => v.max >= v.min).optional(),
  regions: list.optional(),
  indiaStates: list.optional(),
  cities: list.optional(),
  salary: z.object({ min: z.number().min(0), max: z.number().min(0), currency: z.string().regex(/^[A-Z]{3}$/), period: salaryPeriodSchema.optional() }).refine(v => v.max >= v.min).optional(),
  industries: list.optional(),
  employmentTypes: list.optional(),
  companyPreferences: z.object({ preferred: list, excluded: list }).optional(),
  automationConstraints: z.object({ enabled: z.boolean(), dailyCap: z.number().int().min(0).max(100), minimumMatch: z.number().min(0).max(100), excludedMethods: z.array(z.enum(['direct', 'external', 'email'])).max(3) }).optional(),
});
export const jobBaseSchema = z.object({
    title: text,
    category: text,
    country: text,
    state: z.string().max(100).default(''),
    city: text,
    skills: list,
    matching: jobMatchingSchema.optional(),
    mode: z.enum(['Remote', 'Hybrid', 'On-site']),
    type: text,
    salaryMin: z.number().min(0),
    salaryMax: z.number().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
    experienceMin: z.number().min(0).max(70),
    experienceMax: z.number().min(0).max(70),
    description: z.string().min(30).max(15000),
    requirements: z.string().min(10).max(10000),
    method: z.enum(['direct', 'external', 'email']),
    url: z.url().optional(),
    email: z.email().optional(),
  });
export const jobSchema = jobBaseSchema
  .refine(
    (j) => j.salaryMax >= j.salaryMin && j.experienceMax >= j.experienceMin,
    'Maximum values must be at least the minimum.',
  )
  .refine(
    (j) => j.method !== 'external' || j.url?.startsWith('https://'),
    'External applications require an HTTPS URL.',
  )
  .refine(
    (j) => j.method !== 'email' || !!j.email,
    'Email applications require a recruitment email.',
  );
export const contactSchema = z.object({
  name: text,
  email: z.email(),
  subject: text,
  message: z.string().min(10).max(5000),
  consent: z.literal(true),
  website: z.string().max(0).optional(),
  source: z.string().max(200).optional(),
});
export const employerBaseSchema = z.object({
  name: text,
  domain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
  country: text,
  description: z.string().max(3000),
  website: z.url().refine(value => new URL(value).protocol === 'https:', 'Company website must use HTTPS.').optional(),
  industry: z.string().trim().max(200).default(''),
  companySize: z.enum(['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+']).optional(),
  headquarters: z.string().trim().max(300).default(''),
}).strict();
export const employerSchema = employerBaseSchema.superRefine((value, context) => {
  if (!value.website) return;
  const hostname = new URL(value.website).hostname.toLowerCase();
  if (hostname !== value.domain && !hostname.endsWith('.' + value.domain)) context.addIssue({ code: 'custom', path: ['website'], message: 'Website must belong to the company domain.' });
});
export const templateSchema = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().min(10).max(6000),
  signature: z.string().max(1000),
});
