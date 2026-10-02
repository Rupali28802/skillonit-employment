import type { ApplicationStatus, User } from './domain.js';

export type ApplicationMethod = 'EMAIL' | 'EXTERNAL_FORM' | 'SKILLONIT' | 'ATS' | 'UNSUPPORTED';
export type SubmissionState = 'DRAFT' | 'READY' | 'SUBMITTING' | 'SUBMITTED' | 'CONFIRMED' | 'NEEDS_REVIEW' | 'FAILED' | 'CANCELLED';

/** Canonical methods only: never infer a submission capability from a URL or company name. */
export function applicationMethod(method: unknown): ApplicationMethod {
  return method === 'email' ? 'EMAIL' : method === 'external' ? 'EXTERNAL_FORM' : method === 'direct' ? 'SKILLONIT' : method === 'ats' ? 'ATS' : 'UNSUPPORTED';
}

/** Preserve the existing recruiter state machine while exposing delivery independently. */
export function submissionState(status: ApplicationStatus): SubmissionState {
  if (status === 'QUEUED') return 'READY';
  if (status === 'SENDING') return 'SUBMITTING';
  if (['SENT', 'DIRECT_SUBMITTED'].includes(status)) return 'SUBMITTED';
  if (['EXTERNAL_SUBMITTED', 'VIEWED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'REJECTED'].includes(status)) return 'CONFIRMED';
  if (['EXTERNAL_STARTED', 'NEEDS_REVIEW'].includes(status)) return 'NEEDS_REVIEW';
  if (['CANCELLED', 'WITHDRAWN'].includes(status)) return 'CANCELLED';
  return 'FAILED';
}

export const applicationReasons: Record<string, string> = {
  EMAIL_UNVERIFIED: 'Verify your email address.', PROFILE_UNCONFIRMED: 'Complete and confirm your profile.',
  CONFIRMED_CV_REQUIRED: 'Select a confirmed CV.', APPROVED_TEMPLATE_REQUIRED: 'Save and approve your application message.',
  MAILBOX_REQUIRED: 'Gmail connection required for email application.', MAILBOX_NOT_CONNECTED: 'Reconnect your Gmail account.',
  MAILBOX_CONSENT_REQUIRED: 'Allow Gmail applications in your privacy settings.',
  CV_ATTACHMENT_UNAVAILABLE: 'The approved CV attachment is unavailable.', DESTINATION_UNVERIFIED: 'The recruitment email requires verification.',
  JOB_UNAVAILABLE: 'This job is closed, expired, or unavailable.', DIRECT_EMPLOYER_REQUIRED: 'The employer must be verified.',
  DAILY_CAP_REACHED: 'Your application allowance has been reached.', PLAN_AUTOMATION_DISABLED: 'Your plan does not allow automatic applications.',
  AUTOMATION_CONSENT_REQUIRED: 'Confirm your consent for automatic applications.', AUTOMATION_PAUSED: 'Automatic applications are paused.',
  FRAUD_RISK: 'This destination requires a safety review.', CANONICAL_ATS_URL_REQUIRED: 'A valid source application URL is required.',
  EXTERNAL_FORM_UNSUPPORTED: 'Automatic submission is not supported for this form. Complete the application on the source website.',
  ATS_UNSUPPORTED: 'No supported ATS submission integration is configured for this job.', METHOD_UNSUPPORTED: 'The canonical application method is missing or unsupported.',
  ENTITLEMENT_EXPIRED: 'Your automatic application entitlement is no longer active.', MAIL_SEND_FAILED: 'Gmail could not send this application.',
  MAIL_SEND_UNCERTAIN: 'Gmail submission could not be confirmed. Check Gmail Sent before taking further action. Automatic retry is blocked to avoid duplicate emails.',
  MAIL_AUTH_REQUIRED: 'Your Gmail authorization expired or was revoked. Reconnect Gmail.',
  MAIL_RATE_LIMITED: 'Gmail temporarily limited sending. Try again later.',
  APPLICATION_ENGINE_DISABLED: 'Application delivery is currently unavailable. Your attempt is saved for review.',
  MAIL_CONFIGURATION_REQUIRED: 'Gmail sending is not configured. Please contact support.',
  MAX_SEND_ATTEMPTS_REACHED: 'The configured submission attempt limit has been reached. Contact support before retrying.',
};
export const safeApplicationReason = (code: string) => applicationReasons[code] ?? 'This application requires review before it can continue.';

/** Mapping assistance only. No network submission, inferred facts, or arbitrary field values. */
export function mapConfirmedFields(user: User, fields: { name: string; label: string; required: boolean }[], cv?: { id: string; userId: string; confirmed: boolean }) {
  const aliases: Record<string, string> = { 'full name': 'name', name: 'name', 'email address': 'email', email: 'email', education: 'education', experience: 'experience', skills: 'skills', resume: 'cv', cv: 'cv' };
  const values: Record<string, unknown> = user.profile.confirmed ? {
    name: user.profile.name, email: user.verified ? user.email : undefined, education: user.profile.education,
    experience: user.profile.experience, skills: user.profile.skills.length ? user.profile.skills : undefined, cv: cv?.confirmed && cv.userId === user.id ? cv.id : undefined,
  } : {};
  // contactInfo is free text, not a verified phone field. Do not extract/guess a phone number.
  const mapped = fields.map(field => {
    const key = aliases[field.label.trim().toLowerCase().replace(/\s+/g, ' ')];
    const value = key ? values[key] : undefined;
    const known = value !== undefined && value !== null && value !== '';
    return { ...field, ...(known ? { value } : {}), needsConfirmation: field.required && !known };
  });
  return { fields: mapped, missingFields: mapped.filter(field => field.needsConfirmation).map(field => field.label), submissionSupported: false as const };
}
