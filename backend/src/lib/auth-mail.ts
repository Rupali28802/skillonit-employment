import nodemailer from 'nodemailer';
import { z } from 'zod';
import { ApiError } from './security.js';

export type AuthPurpose = 'verify-email' | 'reset-password';
export type AuthMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
};
export interface AuthMailTransport {
  sendMail(message: AuthMessage): Promise<{ accepted: unknown[] }>;
}
const unavailable = () =>
  new ApiError(
    503,
    'VERIFICATION_UNAVAILABLE',
    'Account email delivery is unavailable. Please try again later.',
  );

export function authMailConfig(env = process.env) {
  const parsed = z
    .object({
      ENABLE_AUTH_EMAIL: z.literal('true'),
      SMTP_HOST: z
        .string()
        .min(1)
        .regex(/^[a-zA-Z0-9.-]+$/),
      SMTP_PORT: z.enum(['465', '587']).default('587'),
      SMTP_USER: z.string().min(1),
      SMTP_PASSWORD: z.string().min(1),
      AUTH_EMAIL_FROM: z.email(),
      APP_URL: z.url(),
    })
    .safeParse(env);
  if (!parsed.success) throw unavailable();
  const base = new URL(parsed.data.APP_URL);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  )
    throw unavailable();
  return parsed.data;
}

export function authMessage(
  from: string,
  to: string,
  purpose: AuthPurpose,
  token: string,
  appUrl: string,
): AuthMessage {
  const link = new URL('/' + purpose, appUrl);
  // A fragment keeps the bearer token out of HTTP access logs and referrers.
  link.hash = new URLSearchParams({ token }).toString();
  return {
    from,
    to,
    subject:
      purpose === 'verify-email'
        ? 'Verify your SkillOnIT email'
        : 'Reset your SkillOnIT password',
    text: `Use the following link to ${purpose === 'verify-email' ? 'verify your email address' : 'choose a new password'}:\n\n${link.href}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, ignore this email.`,
  };
}

export async function sendAuthMail(
  to: string,
  purpose: AuthPurpose,
  token: string,
  transport?: AuthMailTransport,
) {
  const config = authMailConfig();
  const mailer =
    transport ||
    nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: Number(config.SMTP_PORT),
      secure: config.SMTP_PORT === '465',
      requireTLS: true,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  try {
    const sent = await mailer.sendMail(
      authMessage(config.AUTH_EMAIL_FROM, to, purpose, token, config.APP_URL),
    );
    if (!sent.accepted.length) throw unavailable();
  } catch {
    // Never expose provider errors: they may contain addresses or credentials.
    throw unavailable();
  }
}
