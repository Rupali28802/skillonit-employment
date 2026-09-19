import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  randomUUID,
} from 'node:crypto';
import { cookies, requestContext } from '../request-context.js';
import { isLocalPreviewOrigin } from './runtime-config.js';
import { read, transaction, type Repository } from './store.js';
import type { User, Role } from './domain.js';
import { captureAnalyticsAudit } from './analytics-events.js';
import { safeLog } from './safe-logger.js';
import { retentionExpiry } from './data-retention.js';
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const id = () => randomUUID();
export const digest = (v: string) =>
  createHash('sha256').update(v).digest('hex');
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function currentUser() {
  const token = (await cookies()).get('skillonit_session')?.value;
  if (!token) return null;
  return read(async (r) => {
    const s = await r.get<{
      userId: string;
      expiresAt: string;
      credentialDigest?: string;
    }>('sessions', digest(token));
    if (
      !s ||
      !Number.isFinite(Date.parse(s.expiresAt)) ||
      Date.parse(s.expiresAt) <= Date.now()
    )
      return null;
    const u = await r.get<User>('users', s.userId);
    return u &&
      !u.disabled &&
      (!s.credentialDigest || s.credentialDigest === digest(u.passwordHash ?? ("google:" + u.googleId)))
      ? u
      : null;
  });
}
export async function requireUser(role?: Role) {
  const u = await currentUser();
  if (!u)
    throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  if (role && u.role !== role)
    throw new ApiError(
      403,
      'FORBIDDEN',
      'You do not have permission for this action.',
    );
  return u;
}
export async function signIn(user: User) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await transaction(async (r) => {
    const stored = await r.get<User>('users', user.id);
    if (!stored || stored.disabled || stored.passwordHash !== user.passwordHash || stored.googleId !== user.googleId)
      throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    await r.put('sessions', {
      id: digest(token),
      userId: user.id,
      credentialDigest: digest(user.passwordHash ?? ("google:" + user.googleId)),
      expiresAt: expiresAt.toISOString(),
      expiresAtDate: expiresAt,
    });
  });
  (await cookies()).set('skillonit_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || process.env.APP_URL?.startsWith('https://') === true,
    path: '/',
    expires: expiresAt,
  });
}
export async function signOut() {
  const c = await cookies();
  const token = c.get('skillonit_session')?.value;
  if (token) await transaction((r) => r.remove('sessions', digest(token)));
  c.delete('skillonit_session');
}
export async function audit(
  r: Repository,
  actorId: string,
  action: string,
  entityId: string,
) {
  const entityType = ({ profile: 'studentProfile', cv: 'cvDocument', ats_cv: 'cvVersion', preferences: 'studentPreferences', onboarding: 'studentOnboarding', automation: 'automationPreferences', consent: 'candidateConsent', catalog: 'studentCatalog', profile_completion: 'configuration' } as Record<string, string>)[action.split('.')[0]];
  await r.put('auditLogs', {
    id: id(),
    actorId,
    action,
    entityId,
    ...(entityType ? { entityType, correlationId: requestContext.getStore()?.response.locals.correlationId ?? id(), metadata: {}, timestamp: new Date().toISOString() } : {}),
    createdAt: new Date().toISOString(),
    expiresAtDate: retentionExpiry('audit'),
  });
  try { await captureAnalyticsAudit(r, actorId, action); }
  catch { safeLog('warn', 'analytics.capture_failed'); }
}
export function safeUser(u: User) {
  const { passwordHash: _secret, ...safe } = u;
  return safe;
}
export async function rateLimit(key: string, limit = 60) {
  const bucket = digest(key + Math.floor(Date.now() / 60000));
  await transaction(async (r) => {
    const previous = await r.get<{ count: number }>('rateLimits', bucket);
    if ((previous?.count || 0) >= limit)
      throw new ApiError(
        429,
        'RATE_LIMIT',
        'Too many requests. Please try again in a minute.',
      );
    await r.put('rateLimits', {
      id: bucket,
      count: (previous?.count || 0) + 1,
      expiresAtDate: new Date(Date.now() + 120000),
    });
  });
}
export function abuseLimits(env = process.env) {
  const parse = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    return value;
  };
  return { requests: parse('ABUSE_REQUESTS_PER_MINUTE', 300, 30, 5000), reads: parse('ABUSE_READS_PER_MINUTE', 240, 20, 5000), webhooks: parse('ABUSE_WEBHOOKS_PER_MINUTE', 600, 30, 10000) };
}
export function sameOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  const expected = process.env.APP_URL || new URL(request.url).origin;
  if (origin && origin !== expected && !isLocalPreviewOrigin(origin))
    throw new ApiError(
      403,
      'ORIGIN_REJECTED',
      'This request did not originate from the application.',
    );
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new ApiError(403, 'ORIGIN_REJECTED', 'Cross-site request rejected.');
}
