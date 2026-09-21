import nodemailer from "nodemailer";
import { safeLog } from './safe-logger.js';
import { z } from "zod";
import { isTrustedAppOrigin } from "./public-origin.js";
import { ApiError } from "./security.js";

export type AuthPurpose = "verify-email" | "reset-password" | "connect-email";
export type AuthMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
};
export interface AuthMailTransport {
  sendMail(message: AuthMessage): Promise<{ accepted: unknown[] }>;
}
const unavailable = () =>
  new ApiError(
    503,
    "VERIFICATION_UNAVAILABLE",
    "Account email delivery is unavailable. Please try again later.",
  );

export function authMailConfig(env = process.env) {
  const parsed = z
    .object({
      ENABLE_AUTH_EMAIL: z.literal("true"),
      SMTP_HOST: z
        .string()
        .min(1)
        .regex(/^[a-zA-Z0-9.-]+$/),
      SMTP_PORT: z.enum(["465", "587"]).default("587"),
      SMTP_USER: z.string().min(1),
      SMTP_PASSWORD: z.string().min(1),
      AUTH_EMAIL_FROM: z.email(),
      APP_URL: z.url(),
    })
    .safeParse(env);
  if (!parsed.success) throw unavailable();
  const base = new URL(parsed.data.APP_URL);
  if (
    !isTrustedAppOrigin(base, env.NODE_ENV) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
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
  candidateName = "there",
): AuthMessage {
  if (purpose === "verify-email") {
    if (!/^[0-9]{6}$/.test(token)) throw unavailable();
    return {
      from,
      to,
      subject: "Verify your SkillOnIT email",
      text:
        "Your SkillOnIT verification code is: " +
        token +
        "\n\nEnter it in the verification form. It expires within 5 minutes and can be used once. If you did not request this code, ignore this email.",
    };
  }
  if (purpose === "connect-email") {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    const link = new URL("/connect-email", appUrl);
    // Keep the bearer token out of HTTP access logs and referrer headers.
    link.hash = new URLSearchParams({ token }).toString();
    const safeName = candidateName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const safeLink = link.href.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    return {
      from,
      to,
      subject: "Connect your email to SkillOnIT",
      text: `Hello ${safeName},\n\nSkillOnIT needs your permission before it can send approved job applications from your Gmail account. Confirm this request, then Google will separately ask for Gmail send-only permission.\n\nConnect My Email: ${link.href}\n\nThis link expires in 15 minutes and can be used once. It does not contain your Gmail password or grant Gmail access by itself. If you did not request this, ignore this email.`,
      html: `<p>Hello ${safeName},</p><p>SkillOnIT needs your permission before it can send approved job applications from your Gmail account. Confirm this request, then Google will separately ask for Gmail send-only permission.</p><p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;background:#155eef;color:#fff;text-decoration:none;border-radius:6px">Connect My Email</a></p><p>This link expires in 15 minutes and can be used once. It does not contain your Gmail password or grant Gmail access by itself. If you did not request this, ignore this email.</p>`,
    };
  }
  const link = new URL("/" + purpose, appUrl);
  // A fragment keeps the bearer token out of HTTP access logs and referrers.
  link.hash = new URLSearchParams({ token }).toString();
  return {
    from,
    to,
    subject: "Reset your SkillOnIT password",
    text: `Use the following link to choose a new password:\n\n${link.href}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, ignore this email.`,
  };
}

export async function sendAuthMail(
  to: string,
  purpose: AuthPurpose,
  token: string,
  transport?: AuthMailTransport,
  candidateName?: string,
) {
  const config = authMailConfig();
  const mailer =
    transport ||
    nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: Number(config.SMTP_PORT),
      secure: config.SMTP_PORT === "465",
      requireTLS: true,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
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
      authMessage(config.AUTH_EMAIL_FROM, to, purpose, token, config.APP_URL, candidateName),
    );
    if (!sent.accepted.length) throw unavailable();
    safeLog('info', 'auth_email.provider_accepted');
  } catch {
    safeLog('error', 'auth_email.delivery_failed');
    // Never expose provider errors: they may contain addresses or credentials.
    throw unavailable();
  }
}
