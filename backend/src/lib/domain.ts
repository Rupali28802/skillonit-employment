export type Role = 'student' | 'employer' | 'admin';
export type PlanCode = 'basic' | 'pro' | 'premium';
export type Job = {
  id: string;
  title: string;
  company: string;
  domain: string;
  country: string;
  state: string;
  city: string;
  category: string;
  skills: string[];
  mode: 'Remote' | 'Hybrid' | 'On-site';
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
};
export type PublicJob = Omit<Job, 'email' | 'domain' | 'url' | 'company'> & {
  company: string;
  identityVisible: boolean;
};
export type Profile = {
  avatarVersion?: string;
  coverVersion?: string;
  logoVersion?: string;
  coverTheme?: string;
  name: string;
  headline: string;
  skills: string[];
  experience: number;
  education: string;
  country: string;
  city: string;
  confirmed: boolean;
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
};
export type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  plan: PlanCode;
  verified: boolean;
  disabled?: boolean;
  createdAt: string;
  profile: Profile;
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
export const countries = [
  'India',
  'United States',
  'United Kingdom',
  'Canada',
  'Germany',
  'Australia',
  'Singapore',
  'United Arab Emirates',
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
  NEEDS_REVIEW: ['QUEUED', 'CANCELLED'],
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
    user?.role === 'admin' ||
    user?.id === job.employerId ||
    !!configuredPlans.find((p) => p.code === user?.plan)?.identity;
  const { email: _email, domain: _domain, url: _url, company, ...safe } = job;
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
  };
}
export function isRecent(job: Job, days = 90, now = Date.now()) {
  return (
    job.status === 'published' &&
    Date.parse(job.discoveredAt) >= now - days * 86400000 &&
    Date.parse(job.expiresAt) > now
  );
}
export function matchJob(job: Job, profile: Profile, preferences: Preferences) {
  const skills = profile.skills.filter((s) =>
    job.skills.some((t) => t.toLowerCase() === s.toLowerCase()),
  );
  const role = [...preferences.roles, ...preferences.relatedRoles].some((r) =>
    job.title.toLowerCase().includes(r.toLowerCase()),
  );
  const experience =
    profile.experience >= job.experienceMin &&
    profile.experience <= job.experienceMax;
  const location =
    !preferences.countries.length ||
    preferences.countries.includes(job.country);
  const mode =
    !preferences.modes.length || preferences.modes.includes(job.mode);
  const excluded = preferences.exclusions.some((s) =>
    (job.title + ' ' + job.company).toLowerCase().includes(s.toLowerCase()),
  );
  return {
    score: excluded
      ? 0
      : Math.round(
          (skills.length / Math.max(job.skills.length, 1)) * 40 +
            Number(role) * 25 +
            Number(experience) * 15 +
            Number(location) * 10 +
            Number(mode) * 10,
        ),
    reasons: [
      skills.length ? `${skills.length} matching skills` : null,
      role ? 'Target or related role' : null,
      experience ? 'Experience fits' : null,
      location ? 'Location fits' : null,
      mode ? 'Work arrangement fits' : null,
    ].filter(Boolean),
  };
}
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
