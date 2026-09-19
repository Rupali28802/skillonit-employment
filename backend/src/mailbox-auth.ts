import { Router } from 'express';
import { safeLog } from './lib/safe-logger.js';
import { OAuth2Client } from 'google-auth-library';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import { cookies, requestContext } from './request-context.js';
import { read, transaction } from './lib/store.js';
import {
  ApiError,
  audit,
  currentUser,
  digest,
  rateLimit,
} from './lib/security.js';
import type { User } from './lib/domain.js';

const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send';
const callbackPath = '/api/v1/mail/google/callback';
const stateCookie = 'skillonit_mail_state';

type MailState = {
  id: string;
  userId: string;
  nonce: string;
  verifier: string;
  credentialDigest: string;
  expiresAtDate: Date;
};

type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
};

export type MailboxConnection = {
  id: string;
  userId: string;
  provider: 'google';
  providerSubject: string;
  email: string;
  scopes: string[];
  refreshToken: EncryptedSecret;
  status: 'connected' | 'revoked';
  connectedAt: string;
  updatedAt: string;
};

const outboundMessageSchema = z
  .object({
    to: z.email(),
    subject: z.string().trim().min(1).max(180),
    text: z.string().min(1).max(100_000),
    attachment: z.object({
      filename: z.string().min(1).max(180).refine(value => !/[\r\n"\\]/.test(value)),
      contentType: z.enum(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
      base64: z.string().min(1).max(8_000_000),
    }).strict().optional(),
  })
  .strict();

function encodedHeader(value: string) {
  if (/\r|\n/.test(value))
    throw new ApiError(400, 'MAIL_INVALID', 'The email message is invalid.');
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function gmailRawMessage(input: z.infer<typeof outboundMessageSchema>) {
  const body = Buffer.from(input.text, 'utf8')
    .toString('base64')
    .match(/.{1,76}/g)
    ?.join('\r\n');
  const headers = [
      `To: ${input.to}`,
      `Subject: ${encodedHeader(input.subject)}`,
      'MIME-Version: 1.0',
  ];
  if (input.attachment) {
    const boundary = `skillonit-${randomBytes(18).toString('hex')}`;
    return Buffer.from([
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body || '',
      `--${boundary}`, `Content-Type: ${input.attachment.contentType}; name="${input.attachment.filename}"`,
      'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${input.attachment.filename}"`, '',
      input.attachment.base64.match(/.{1,76}/g)?.join('\r\n') || '', `--${boundary}--`, '',
    ].join('\r\n'), 'utf8').toString('base64url');
  }
  return Buffer.from(
    [
      ...headers,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      body || '',
    ].join('\r\n'),
    'utf8',
  ).toString('base64url');
}

function credentialDigest(user: User) {
  return digest(user.passwordHash ?? `google:${user.googleId}`);
}

export function mailboxConfig(env = process.env) {
  const parsed = z
    .object({
      MAIL_GOOGLE_CLIENT_ID: z.string().min(1),
      MAIL_GOOGLE_CLIENT_SECRET: z.string().min(1),
      MAIL_GOOGLE_CALLBACK_URL: z.url().optional(),
      MAIL_TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      AUTH_OTP_SECRET: z.string().regex(/^[a-f0-9]{64,}$/i).optional(),
      APP_URL: z.url(),
    })
    .refine(
      (value) => value.MAIL_TOKEN_ENCRYPTION_KEY || value.AUTH_OTP_SECRET,
      'A server encryption secret is required.',
    )
    .safeParse(env);
  if (!parsed.success)
    throw new ApiError(
      503,
      'MAILBOX_UNAVAILABLE',
      'Mailbox authorization is not configured yet.',
    );
  const config = parsed.data;
  const app = new URL(config.APP_URL);
  const callback = new URL(
    config.MAIL_GOOGLE_CALLBACK_URL || callbackPath,
    config.APP_URL,
  );
  if (
    app.protocol !== 'https:' ||
    app.pathname !== '/' ||
    app.search ||
    app.hash ||
    app.username ||
    app.password ||
    callback.origin !== app.origin ||
    callback.pathname !== callbackPath ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    throw new ApiError(
      503,
      'MAILBOX_UNAVAILABLE',
      'Mailbox authorization configuration is invalid.',
    );
  const encryptionKey =
    config.MAIL_TOKEN_ENCRYPTION_KEY ||
    createHash('sha256')
      .update('skillonit:mailbox-oauth:v1\0')
      .update(config.AUTH_OTP_SECRET!)
      .digest('hex');
  return {
    ...config,
    MAIL_GOOGLE_CALLBACK_URL: callback.href,
    MAIL_TOKEN_ENCRYPTION_KEY: encryptionKey,
  };
}

export function encryptRefreshToken(token: string, keyHex: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptRefreshToken(secret: EncryptedSecret, keyHex: string) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyHex, 'hex'),
    Buffer.from(secret.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export async function mailboxStatus(userId: string) {
  let available = true;
  try {
    mailboxConfig();
  } catch {
    available = false;
  }
  const connection = await read((repository) =>
    repository.get<MailboxConnection>('mailboxConnections', userId),
  );
  return {
    available,
    connected: connection?.status === 'connected',
    provider: connection?.status === 'connected' ? connection.provider : null,
    email: connection?.status === 'connected' ? connection.email : null,
    scopes: connection?.status === 'connected' ? connection.scopes : [],
  };
}

export async function beginMailboxConnect(user: User) {
  if (!user.verified)
    throw new ApiError(
      409,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your SkillOnIT email before connecting a mailbox.',
    );
  const config = mailboxConfig();
  await rateLimit(`mail-connect:${user.id}`, 5);
  const client = new OAuth2Client(
    config.MAIL_GOOGLE_CLIENT_ID,
    config.MAIL_GOOGLE_CLIENT_SECRET,
    config.MAIL_GOOGLE_CALLBACK_URL,
  );
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  await transaction((repository) =>
    repository.put<MailState>('mailOauthStates', {
      id: digest(state),
      userId: user.id,
      nonce,
      verifier: codeVerifier,
      credentialDigest: credentialDigest(user),
      expiresAtDate: new Date(Date.now() + 10 * 60_000),
    }),
  );
  cookies().set(stateCookie, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/v1/mail/google',
    maxAge: 10 * 60_000,
  });
  const url = new URL(client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: true,
    scope: ['openid', 'email', gmailSendScope],
    state,
    nonce,
  }));
  url.searchParams.set('code_challenge', codeChallenge!);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}

export async function sendMailboxMessage(
  user: User,
  input: z.infer<typeof outboundMessageSchema>,
) {
  const message = outboundMessageSchema.parse(input);
  const config = mailboxConfig();
  await rateLimit(`mail-send:${user.id}`, 10);
  const connection = await read((repository) =>
    repository.get<MailboxConnection>('mailboxConnections', user.id),
  );
  if (
    !connection ||
    connection.status !== 'connected' ||
    connection.email !== user.email.toLowerCase() ||
    connection.scopes.length !== 1 ||
    connection.scopes[0] !== gmailSendScope
  )
    throw new ApiError(
      409,
      'MAILBOX_NOT_CONNECTED',
      'Connect your verified mailbox before sending email.',
    );
  try {
    const client = new OAuth2Client(
      config.MAIL_GOOGLE_CLIENT_ID,
      config.MAIL_GOOGLE_CLIENT_SECRET,
    );
    client.setCredentials({
      refresh_token: decryptRefreshToken(
        connection.refreshToken,
        config.MAIL_TOKEN_ENCRYPTION_KEY,
      ),
    });
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('Access token unavailable');
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: gmailRawMessage(message) }),
      },
    );
    if (!response.ok) throw new Error('Gmail send rejected');
    const result = z.object({ id: z.string().min(1) }).parse(await response.json());
    await transaction((repository) =>
      audit(repository, user.id, 'mail.sent', user.id),
    );
    return { accepted: true, providerMessageId: result.id };
  } catch {
    throw new ApiError(
      502,
      'MAIL_SEND_FAILED',
      'The email provider could not send the message.',
    );
  }
}

export function mailboxConnectStartUrl(user: User) {
  if (!user.verified)
    throw new ApiError(
      409,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your SkillOnIT email before connecting a mailbox.',
    );
  mailboxConfig();
  return '/api/v1/mail/google';
}

export async function disconnectMailbox(user: User) {
  const connection = await read((repository) =>
    repository.get<MailboxConnection>('mailboxConnections', user.id),
  );
  if (connection) {
    try {
      const config = mailboxConfig();
      const token = decryptRefreshToken(
        connection.refreshToken,
        config.MAIL_TOKEN_ENCRYPTION_KEY,
      );
      const client = new OAuth2Client(
        config.MAIL_GOOGLE_CLIENT_ID,
        config.MAIL_GOOGLE_CLIENT_SECRET,
      );
      await client.revokeToken(token);
    } catch {
      // Local access is removed even when Google is temporarily unreachable.
    }
    await transaction(async (repository) => {
      await repository.remove('mailboxConnections', user.id);
      await audit(repository, user.id, 'mail.disconnected', user.id);
    });
  }
  return { connected: false };
}

export const mailboxAuth = Router();
mailboxAuth.use((request, response, next) =>
  requestContext.run({ request, response }, next),
);

mailboxAuth.get('/google', async (_request, response) => {
  response.set('Referrer-Policy', 'no-referrer');
  let appUrl = process.env.APP_URL || 'https://invalid.example';
  try {
    const config = mailboxConfig();
    appUrl = config.APP_URL;
    const user = await currentUser();
    if (!user || user.role !== 'student')
      throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
    response.redirect(302, await beginMailboxConnect(user));
  } catch {
    response.redirect(303, new URL('/mail?mail=error', appUrl).href);
  }
});

mailboxAuth.get('/google/callback', async (request, response) => {
  response.set('Referrer-Policy', 'no-referrer');
  let appUrl = process.env.APP_URL || 'https://invalid.example';
  try {
    const config = mailboxConfig();
    appUrl = config.APP_URL;
    const { code, state } = z
      .object({
        code: z.string().min(1).max(4096),
        state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .parse(request.query);
    const cookie = cookies().get(stateCookie)?.value;
    if (
      !cookie ||
      cookie.length !== state.length ||
      !timingSafeEqual(Buffer.from(cookie), Buffer.from(state))
    )
      throw new Error('State rejected');
    response.clearCookie(stateCookie, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/v1/mail/google',
    });
    const saved = await transaction(async (repository) => {
      const row = await repository.get<MailState>('mailOauthStates', digest(state));
      if (!row || new Date(row.expiresAtDate).getTime() <= Date.now())
        throw new Error('State expired');
      await repository.remove('mailOauthStates', row.id);
      return row;
    });
    const user = await currentUser();
    if (
      !user ||
      user.id !== saved.userId ||
      credentialDigest(user) !== saved.credentialDigest ||
      !user.verified
    )
      throw new Error('Authenticated session changed');
    const client = new OAuth2Client(
      config.MAIL_GOOGLE_CLIENT_ID,
      config.MAIL_GOOGLE_CLIENT_SECRET,
      config.MAIL_GOOGLE_CALLBACK_URL,
    );
    const { tokens } = await client.getToken({
      code,
      codeVerifier: saved.verifier,
      redirect_uri: config.MAIL_GOOGLE_CALLBACK_URL,
    });
    if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token)
      throw new Error('Required authorization missing');
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.MAIL_GOOGLE_CLIENT_ID,
    });
    const identity = ticket.getPayload();
    const providerEmail = z.email().parse(identity?.email).toLowerCase();
    if (
      !identity ||
      identity.nonce !== saved.nonce ||
      identity.email_verified !== true ||
      !identity.email ||
      !identity.sub ||
      providerEmail !== user.email.toLowerCase() ||
      (identity.azp && identity.azp !== config.MAIL_GOOGLE_CLIENT_ID)
    )
      throw new Error('Identity rejected');
    const tokenInfo = await client.getTokenInfo(tokens.access_token);
    if (!tokenInfo.scopes.includes(gmailSendScope))
      throw new Error('Send permission missing');
    const now = new Date().toISOString();
    const existing = await read((repository) =>
      repository.get<MailboxConnection>('mailboxConnections', user.id),
    );
    const connection: MailboxConnection = {
      id: user.id,
      userId: user.id,
      provider: 'google',
      providerSubject: identity.sub,
      email: providerEmail,
      scopes: [gmailSendScope],
      refreshToken: encryptRefreshToken(
        tokens.refresh_token,
        config.MAIL_TOKEN_ENCRYPTION_KEY,
      ),
      status: 'connected',
      connectedAt: existing?.connectedAt || now,
      updatedAt: now,
    };
    await transaction(async (repository) => {
      await repository.put('mailboxConnections', connection);
      await audit(repository, user.id, 'mail.connected', user.id);
    });
    response.redirect(303, new URL('/mail?mail=connected', appUrl).href);
  } catch {
    safeLog('warn', 'mailbox_oauth.callback_rejected');
    response.redirect(303, new URL('/mail?mail=error', appUrl).href);
  }
});
