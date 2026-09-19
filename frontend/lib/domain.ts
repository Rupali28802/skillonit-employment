export { countries } from './countries';
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
  normalizedFacts?: {salary:{period:string|null}};
};
export type PublicJob = Omit<Job, 'email' | 'domain' | 'url' | 'company'> & {
  company: string;
  identityVisible: boolean;
  sourceLink?: string;
  publicApplicationLink?: string;
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
  employmentHistory?: { title: string; employer: string; start: string; end: string; description: string }[];
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
  role: Role;
  plan: PlanCode;
  verified: boolean;
  disabled?: boolean;
  createdAt: string;
  profile: Profile;
  profileRevision?: number;
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
