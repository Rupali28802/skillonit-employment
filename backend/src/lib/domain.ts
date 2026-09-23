import type { CandidateMatching, JobMatching } from './matching-contracts.js';
export type Role = 'student' | 'employer' | 'admin';
export type PlanCode = 'basic' | 'pro' | 'premium';
export type Job = {
  id: string;
  title: string;
  company: string;
  domain: string;
  country: string;
  eligibleCountries?: string[];
  state: string;
  city: string;
  category: string;
  skills: string[];
  mode: 'Remote' | 'Hybrid' | 'On-site' | 'Not specified';
  type: string;
  salaryMin: number;
  salaryMax: number;
  currency: string;
  experienceMin: number;
  experienceMax: number;
  description: string;
  requirements: string;
  method: 'direct' | 'external' | 'email';
  url?: string;
  email?: string;
  status: 'draft' | 'review' | 'published' | 'closed' | 'disabled';
  trust: 'verified' | 'pending' | 'flagged';
  employerId: string;
  source: string;
  discoveredAt: string;
  expiresAt: string;
  sample?: boolean;
  mnc?: boolean;
  salaryDisclosed?: boolean;
  experienceDisclosed?: boolean;
  salaryText?: string;
  sourcePostedAt?: string;
  sourceUpdatedAt?: string;
  sourceExpiresAt?: string;
  risk?: { reasons: string[]; assessedAt: string; method: 'rules-v1' };
  normalizedFacts?: {
    city: string | null; state: string | null; locationText: string;
    skills: string[]; experience: { min: number | null; max: number | null; text: string | null };
    salary: { min: number | null; max: number | null; currency: string | null; period: string | null; text: string | null };
    postedAt: string | null; updatedAt: string | null; expiresAt: string | null;
    sourceCategory: string | null; sourceTags: string[];
    normalizedAt: string; method: 'source-fields';
  };
  feed?: { sourceId: string; externalId: string; publicListing: boolean; attributionUrl: string; lastSeenAt: string; applicationTarget?: 'direct-form' | 'source-job-page' | 'source-redirect'; closedByEngine?: boolean };
  matching?: JobMatching;
  lifecycle?: { schemaVersion: 1; state: 'publishing' | 'active' | 'expired' | 'closed' | 'removed' | 'reposted'; revision: number; changedAt: string; reasonCode: string; declaredExpiresAt?: string; effectiveExpiresAt?: string };
};
export type PublicJob = Omit<Job, 'email' | 'domain' | 'url' | 'company' | 'feed'> & {
  company: string;
  identityVisible: boolean;
  sourceLink?: string;
  publicApplicationLink?: string;
  applicationTarget?: 'direct-form' | 'source-job-page' | 'source-redirect';
  sourceJobId?: string;
};
export type Profile = {
  avatarVersion?: string;
  coverVersion?: string;
  logoVersion?: string;
  coverTheme?: string;
  name: string;
  headline: string;
  skills: string[];
  experience: number | null;
  education: string;
  country: string;
  city: string;
  confirmed: boolean;
  matching?: CandidateMatching;
  employmentHistory?: { title: string; employer: string; start: string; end: string; description: string }[];
  contactInfo?: string;
  region?: string;
  industry?: string;
  targetRole?: string;
  certifications?: string[];
  projects?: string[];
  professionalLinks?: string[];
  languages?: string[];
  availability?: string;
  relocation?: string;
};
export type Preferences = {
  roles: string[];
  relatedRoles: string[];
  countries: string[];
  modes: string[];
  exclusions: string[];
  automation: boolean;
  dailyCap: number;
  consentAt?: string;
  skills?: string[];
  experience?: { min: number; max: number };
  regions?: string[];
  indiaStates?: string[];
  cities?: string[];
  salary?: { min: number; max: number; currency: string; period?: 'hour' | 'month' | 'year' };
  industries?: string[];
  employmentTypes?: string[];
  companyPreferences?: { preferred: string[]; excluded: string[] };
  automationConstraints?: { enabled: boolean; dailyCap: number; minimumMatch: number; excludedMethods: ('direct' | 'external' | 'email')[] };
};
export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  googleId?: string;
  authProvider?: "google" | "password";
  isVerified?: boolean;
  role: Role;
  plan: PlanCode;
  verified: boolean;
  disabled?: boolean;
  createdAt: string;
  profile: Profile;
  profileRevision?: number;
  activeCvVersionId?: string | null;
  profileProvenance?: Record<string, { source: string; status: string }>;
  cvQuotaRevision?: number;
  profileUpdatedAt?: string;
  profileConfirmedAt?: string;
  preferences: Preferences;
};
export type Plan = {
  code: PlanCode;
  name: string;
  price: number | null;
  currency: string;
  dailyCap: number;
  delayMinutes: number;
  identity: boolean;
  autoApply: boolean;
  cvs: number;
  /** Separate automation allowance. Defaults to dailyCap for enabled plans. */
  autoApplyDailyCap?: number;
  /** Billing period used only after a verified payment or administrator grant. */
  billingPeriodDays?: number;
};
export const plans: Plan[] = [
  {
    code: 'basic',
    name: 'Basic',
    price: null,
    currency: 'INR',
    dailyCap: 5,
    delayMinutes: 1440,
    identity: false,
    autoApply: false,
    cvs: 1,
    autoApplyDailyCap: 0,
    billingPeriodDays: 30,
  },
  {
    code: 'pro',
    name: 'Pro',
    price: null,
    currency: 'INR',
    dailyCap: 25,
    delayMinutes: 60,
    identity: true,
    autoApply: true,
    cvs: 3,
    autoApplyDailyCap: 10,
    billingPeriodDays: 30,
  },
  {
    code: 'premium',
    name: 'Premium',
    price: null,
    currency: 'INR',
    dailyCap: 50,
    delayMinutes: 0,
    identity: true,
    autoApply: true,
    cvs: 5,
    autoApplyDailyCap: 50,
    billingPeriodDays: 30,
  },
];
export const categories = [
  'Technology',
  'Design',
  'Marketing',
  'Finance',
  'Healthcare',
  'Engineering',
  'Education',
  'Sales',
  'Operations',
  'Hospitality',
  'Legal',
  'Logistics',
];
export const states = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];
export type ApplicationStatus =
  | 'QUEUED'
  | 'NEEDS_REVIEW'
  | 'SENDING'
  | 'SENT'
  | 'EXTERNAL_STARTED'
  | 'EXTERNAL_SUBMITTED'
  | 'DIRECT_SUBMITTED'
  | 'VIEWED'
  | 'SHORTLISTED'
  | 'INTERVIEW'
  | 'OFFER'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'CANCELLED'
  | 'FAILED';
export const transitions: Record<ApplicationStatus, ApplicationStatus[]> = {
  QUEUED: ['NEEDS_REVIEW', 'SENDING', 'CANCELLED', 'FAILED'],
  NEEDS_REVIEW: ['QUEUED', 'EXTERNAL_STARTED', 'CANCELLED'],
  SENDING: ['SENT', 'FAILED'],
  SENT: ['INTERVIEW', 'REJECTED'],
  EXTERNAL_STARTED: ['EXTERNAL_SUBMITTED', 'WITHDRAWN'],
  EXTERNAL_SUBMITTED: ['VIEWED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  DIRECT_SUBMITTED: [
    'VIEWED',
    'SHORTLISTED',
    'INTERVIEW',
    'OFFER',
    'REJECTED',
    'WITHDRAWN',
  ],
  VIEWED: ['SHORTLISTED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  SHORTLISTED: ['INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'],
  INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['WITHDRAWN'],
  REJECTED: [],
  WITHDRAWN: [],
  CANCELLED: [],
  FAILED: ['QUEUED', 'CANCELLED'],
};
export function canTransition(from: ApplicationStatus, to: ApplicationStatus) {
  return transitions[from]?.includes(to) ?? false;
}
export function publicJob(
  job: Job,
  user?: Pick<User, 'role' | 'plan' | 'id'> | null,
  configuredPlans = plans,
): PublicJob {
  const identityVisible =
    job.feed?.publicListing === true ||
    user?.role === 'admin' ||
    user?.id === job.employerId ||
    !!configuredPlans.find((p) => p.code === user?.plan)?.identity;
  const { email: _email, domain: _domain, url: _url, company, feed, ...safe } = job;
  const scrub = (text: string) => {
    if (identityVisible) return text;
    let result = text;
    for (const value of [company, job.domain, job.email, job.url].filter(
      (v): v is string => !!v,
    ))
      result = result.replace(
        new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        '[identity protected]',
      );
    return result
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[contact protected]')
      .replace(/https?:\/\/\S+/gi, '[link protected]');
  };
  return {
    ...safe,
    title: scrub(safe.title),
    description: scrub(safe.description),
    requirements: scrub(safe.requirements),
    source: scrub(safe.source),
    company: identityVisible ? company : 'Company identity protected',
    identityVisible,
    ...(feed?.publicListing ? { sourceLink: feed.attributionUrl, publicApplicationLink: job.url, applicationTarget: feed.applicationTarget, sourceJobId: feed.externalId } : {}),
  };
}
export function isRecent(job: Job, days = 90, now = Date.now()) {
  const state = job.lifecycle?.state;
  const publishedAt = Date.parse(job.sourcePostedAt || job.discoveredAt);
  return (
    job.status === 'published' &&
    (!state || state === 'active') &&
    Number.isFinite(publishedAt) &&
    publishedAt >= now - days * 86400000 &&
    Date.parse(job.expiresAt) > now
  );
}
export { matchJob } from './job-matching.js';
export function eligibility(
  user: User,
  job: Job,
  plan: Plan,
  used: number,
  mailboxConnected = false,
  now = Date.now(),
): string[] {
  const reasons: string[] = [];
  if (!user.verified) reasons.push('Verify your email first.');
  if (!user.profile.confirmed || !user.profile.skills.length)
    reasons.push('Confirm a complete candidate profile.');
  if (!isRecent(job, 90, now))
    reasons.push('This job is no longer accepting applications.');
  if (job.trust !== 'verified')
    reasons.push('Employer verification is required.');
  if (used >= plan.dailyCap) reasons.push('Daily plan allowance reached.');
  if (used >= user.preferences.dailyCap)
    reasons.push('Your personal daily application cap has been reached.');
  if (
    job.method === 'email' &&
    (!plan.autoApply ||
      !user.preferences.automation ||
      !user.preferences.consentAt ||
      !mailboxConnected)
  )
    reasons.push(
      'An eligible plan, explicit consent and connected mailbox are required.',
    );
  return reasons;
}
import { countries } from './countries.js';
export { countries };
