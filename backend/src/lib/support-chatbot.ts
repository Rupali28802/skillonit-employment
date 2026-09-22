import { z } from 'zod';
import { ApiError, rateLimit } from './security.js';
import { safeLog } from './safe-logger.js';

export const supportSuggestions = [
  'How do I create my profile?',
  'How do I upload my CV?',
  'How does job matching work?',
  'How do I connect Gmail?',
] as const;

const requestSchema = z.object({
  message: z.string().trim().min(1).max(500),
}).strict();

type SupportTopic = {
  id: string;
  match: RegExp;
  answer: string;
  links: { label: string; href: string }[];
};

const topics: SupportTopic[] = [
  {
    id: 'registration_login',
    match: /\b(sign\s?up|register|registration|log\s?in|sign\s?in|password|otp|verify email)\b/i,
    answer: 'Create an account from Register, verify your email with the one-time code, then sign in. You can also use Continue with Google when it is available for your account.',
    links: [{ label: 'Register', href: '/register' }, { label: 'Sign in', href: '/login' }],
  },
  {
    id: 'profile',
    match: /\b(profile|headline|skills|experience|education|qualification|occupation)\b/i,
    answer: 'Open My Workspace, choose My Profile, and use Edit Profile to add or update confirmed information. Review the details before saving so matching uses only facts you have confirmed.',
    links: [{ label: 'My profile', href: '/profile' }],
  },
  {
    id: 'cv',
    match: /\b(cv|resume|curriculum|upload document|cv version)\b/i,
    answer: 'Go to My Profile or My CVs and choose Upload CV. SkillOnIT creates a reviewable draft from supported facts; check and confirm it before those facts become part of your profile.',
    links: [{ label: 'My CVs', href: '/cvs' }],
  },
  {
    id: 'job_search',
    match: /\b(find job|job search|search job|discover|job discovery|filter|worldwide job)\b/i,
    answer: 'Use Find Jobs to search by role, location, work mode, experience, and job type. Results come from connected sources and can be filtered or sorted before you open a job.',
    links: [{ label: 'Find jobs', href: '/' }],
  },
  {
    id: 'matching',
    match: /\b(match|matching|recommended|recommendation|suitable job)\b/i,
    answer: 'Job matching compares active, verified jobs with your confirmed profile, approved CV facts, and saved preferences. Unconfirmed CV extraction is not used for personalized matching.',
    links: [{ label: 'Job preferences', href: '/preferences' }],
  },
  {
    id: 'saved_jobs',
    match: /\b(save job|saved job|bookmark)\b/i,
    answer: 'Select Save on a job to add it to your Saved Jobs list. You must be signed in to save or remove jobs.',
    links: [{ label: 'Saved jobs', href: '/saved' }],
  },
  {
    id: 'applications',
    match: /\b(apply|application|application status|track application|auto.?apply)\b/i,
    answer: 'Open a job to review its details and available application method. Track recorded applications from My Workspace → Applications. Automatic applications require confirmed profile data, the required consent and services, and an eligible plan.',
    links: [{ label: 'Applications', href: '/applications' }],
  },
  {
    id: 'gmail',
    match: /\b(gmail|connect email|email connection|mailbox|send permission)\b/i,
    answer: 'Go to My Profile and select Connect Email. Open the verification email, choose Connect My Email, then grant the Gmail send permission. SkillOnIT requests send access only and never asks for your Gmail password.',
    links: [{ label: 'Email integration', href: '/mail' }],
  },
  {
    id: 'templates',
    match: /\b(template|cover letter|email draft|application message)\b/i,
    answer: 'Application templates are available from My Workspace → Email Templates. Templates must use confirmed candidate information and supported placeholders.',
    links: [{ label: 'Email templates', href: '/templates' }],
  },
  {
    id: 'plans',
    match: /\b(plan|pricing|subscription|upgrade|billing|payment|quota|limit)\b/i,
    answer: 'Open Plans to compare the currently available subscriptions and limits. Your active plan and usage are shown in My Workspace. Payment and entitlement changes happen only through the billing flow.',
    links: [{ label: 'View plans', href: '/pricing' }, { label: 'Billing', href: '/billing' }],
  },
  {
    id: 'privacy',
    match: /\b(privacy|consent|account setting|delete account|security|personal data)\b/i,
    answer: 'Open Privacy & Settings to review consent and account controls. SkillOnIT separates permissions by purpose, and revoking a permission can disable the related feature.',
    links: [{ label: 'Privacy & settings', href: '/settings' }],
  },
  {
    id: 'navigation',
    match: /\b(dashboard|workspace|navigate|where (is|are)|how (does|do) skillonit|what is skillonit|help)\b/i,
    answer: 'SkillOnIT brings job discovery, your confirmed profile and CV, preferences, saved jobs, applications, email connection, and subscription controls into one workspace. Use Find Jobs for discovery and My Workspace for your account tools.',
    links: [{ label: 'My workspace', href: '/dashboard' }, { label: 'Find jobs', href: '/' }],
  },
];

function normalize(message: string) {
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function answerSupportQuestion(rawMessage: string) {
  const message = normalize(rawMessage);
  if (/\b(another user|other user|someone else|token|password|secret|credential|api key)\b/i.test(message)) return {
    intent: 'privacy_boundary',
    answered: false,
    answer: 'I cannot access or disclose passwords, credentials, private account information, CVs, Gmail data, or another user’s records. Use Privacy & Settings for your own account controls.',
    links: [{ label: 'Privacy & settings', href: '/settings' }],
  };
  const topic = topics.find((entry) => entry.match.test(message));
  if (!topic) return {
    intent: 'unknown',
    answered: false,
    answer: 'I cannot confirm that from the approved SkillOnIT support information. Please try one of the suggested questions or use the Contact page for additional help.',
    links: [{ label: 'Contact SkillOnIT', href: '/contact' }],
  };
  return { intent: topic.id, answered: true, answer: topic.answer, links: topic.links };
}

export async function runSupportChat(raw: unknown, clientId: string) {
  const input = requestSchema.parse(raw);
  const message = normalize(input.message);
  if (!message) throw new ApiError(400, 'SUPPORT_MESSAGE_REQUIRED', 'Enter a support question.');
  const configured = Number(process.env.SUPPORT_CHAT_PER_MINUTE || 20);
  const limit = Number.isInteger(configured) && configured >= 2 && configured <= 60 ? configured : 20;
  await rateLimit(`support-chat:${clientId}`, limit);
  const result = answerSupportQuestion(message);
  safeLog('info', 'support_chat.requested', { operation: result.intent, failed: !result.answered });
  return { ...result, suggestions: supportSuggestions };
}
