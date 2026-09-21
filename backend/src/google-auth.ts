import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { cookies, requestContext } from './request-context.js';
import { transaction } from './lib/store.js';
import { ApiError, audit, currentUser, digest, id, rateLimit, signIn } from './lib/security.js';
import type { User } from './lib/domain.js';
import { safeLog } from './lib/safe-logger.js';
import { isTrustedAppOrigin } from './lib/public-origin.js';

const cookieName = 'skillonit_google_state';
const callbackPath = '/api/v1/auth/google/callback';
export function googleConfig(env = process.env) {
  const parsed = z.object({ GOOGLE_CLIENT_ID: z.string().min(1), GOOGLE_CLIENT_SECRET: z.string().min(1), GOOGLE_CALLBACK_URL: z.url(), APP_URL: z.url() }).safeParse(env);
  if (!parsed.success) throw new ApiError(503, 'GOOGLE_UNAVAILABLE', 'Google sign-in is not configured.');
  const c = parsed.data, app = new URL(c.APP_URL), callback = new URL(c.GOOGLE_CALLBACK_URL);
  if (!isTrustedAppOrigin(app, env.NODE_ENV) || app.pathname !== '/' || app.search || app.hash || app.username || app.password || callback.origin !== app.origin || callback.pathname !== callbackPath || callback.search || callback.hash || callback.username || callback.password)
    throw new ApiError(503, 'GOOGLE_UNAVAILABLE', 'Google sign-in configuration is invalid.');
  return c;
}
type State = { id: string; nonce: string; verifier: string; expiresAtDate: Date; linkUserId?: string; linkCredential?: string; returnTo?: string };
type Identity = { sub: string; email: string; name: string; emailVerified: boolean; hostedDomain?: string };

// Called only with a server-validated Google ID token. Google is authoritative
// for Gmail and verified Workspace identities, not arbitrary third-party emails.
export async function resolveGoogleUser(identity: Identity, linking?: User) {
  if (identity.emailVerified !== true || !identity.sub)
    throw new ApiError(400, 'GOOGLE_REJECTED', 'Google sign-in could not be completed.');
  const authoritativeEmail = identity.email.endsWith('@gmail.com') || !!identity.hostedDomain;
  return transaction(async r => {
    const google = (await r.find<User>('users', { googleId: identity.sub }, 1))[0];
    if (google) {
      if (google.disabled) throw new ApiError(403, 'GOOGLE_REJECTED', 'Google sign-in could not be completed.');
      return google;
    }
    const existing = (await r.find<User>('users', { email: identity.email }, 1))[0];
    if (existing) {
      if (existing.disabled || existing.googleId)
        throw new ApiError(409, 'GOOGLE_REJECTED', 'Google sign-in could not be completed.');
      const localProof = linking && linking.id === existing.id && linking.passwordHash === existing.passwordHash;
      if (!authoritativeEmail && !localProof)
        throw new ApiError(409, 'GOOGLE_EMAIL_PROOF_REQUIRED', 'This email provider requires additional account ownership verification.');
      const linked = { ...existing, googleId: identity.sub, verified: true, isVerified: true, authProvider: existing.authProvider || 'password' as const };
      await r.put('users', linked);
      await audit(r, existing.id, 'auth.google_linked', existing.id);
      return linked;
    }
    const user: User = {
      id: id(), email: identity.email, name: identity.name, googleId: identity.sub,
      authProvider: 'google', passwordHash: null, verified: true, isVerified: true,
      role: 'student', plan: 'basic', createdAt: new Date().toISOString(),
      profile: { name: identity.name, headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false },
      preferences: { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 5 },
    };
    await r.put('users', user);
    await audit(r, user.id, 'auth.google_registered', user.id);
    return user;
  });
}

export const googleAuth = Router();
googleAuth.use((req, res, next) => requestContext.run({ request: req, response: res }, next));
// Frontend readiness and canonical entry URL; the existing OAuth flow below is unchanged.
googleAuth.get('/google/status', (_req, res) => {
  try { const config = googleConfig(); res.json({ data: { available: true, startUrl: new URL('/api/v1/auth/google', config.APP_URL).href } }); }
  catch { res.json({ data: { available: false } }); }
});
googleAuth.get('/google', async (req, res) => {
  try {
    const c = googleConfig();
    await rateLimit('google-start:' + (req.socket.remoteAddress || 'local'), 10);
    const client = new OAuth2Client(c.GOOGLE_CLIENT_ID, c.GOOGLE_CLIENT_SECRET, c.GOOGLE_CALLBACK_URL);
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
    const returnTo = req.query.next === '/connect-email' ? '/connect-email' : undefined;
    const user = await currentUser();
    safeLog('info', 'google_oauth.start_session', {
      cookiePresent: !!cookies().get('skillonit_session'),
      authenticated: !!user,
    });
    await transaction(r => r.put('oauthStates', {
      id: digest(state), nonce, verifier: codeVerifier, expiresAtDate: new Date(Date.now() + 600000),
      ...(returnTo ? { returnTo } : {}),
      ...(user ? { linkUserId: user.id, linkCredential: digest(user.passwordHash ?? ('google:' + user.googleId)) } : {}),
    }));
    res.cookie(cookieName, state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/auth/google', maxAge: 600000 });
    const url = new URL(client.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce, prompt: 'select_account', access_type: 'online' }));
    url.searchParams.set('code_challenge', codeChallenge!); url.searchParams.set('code_challenge_method', 'S256');
    res.redirect(302, url.href);
  } catch (e) {
    res.status(e instanceof ApiError ? e.status : 503).json({ error: { code: 'GOOGLE_UNAVAILABLE', message: 'Google sign-in is unavailable. Please try again later.' } });
  }
});
googleAuth.get('/google/callback', async (req, res) => {
  res.set('Referrer-Policy', 'no-referrer');
  // Log only fixed stage names: never requests, identities, cookies or provider errors.
  let stage = 'callback_validation';
  safeLog('info', 'google_oauth.callback_received');
  try {
    const { code, state } = z.object({ code: z.string().min(1).max(4096), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).parse(req.query);
    const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!cookie || cookie.length !== state.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(state))) throw new Error('State rejected');
    res.clearCookie(cookieName, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/auth/google' });
    stage = 'state_consumption';
    const saved = await transaction(async r => {
      const row = await r.get<State>('oauthStates', digest(state));
      if (!row || new Date(row.expiresAtDate).getTime() <= Date.now()) throw new Error('State expired');
      await r.remove('oauthStates', row.id); return row;
    });
    stage = 'configuration';
    const c = googleConfig();
    const client = new OAuth2Client(c.GOOGLE_CLIENT_ID, c.GOOGLE_CLIENT_SECRET, c.GOOGLE_CALLBACK_URL);
    stage = 'code_exchange_pkce';
    const { tokens } = await client.getToken({ code, codeVerifier: saved.verifier, redirect_uri: c.GOOGLE_CALLBACK_URL });
    if (!tokens.id_token) throw new Error('Identity missing');
    stage = 'identity_validation';
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: c.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || payload.nonce !== saved.nonce || payload.email_verified !== true || !payload.sub || !payload.email || (payload.azp && payload.azp !== c.GOOGLE_CLIENT_ID)) throw new Error('Identity rejected');
    const email = z.email().parse(payload.email).toLowerCase();
    safeLog('info', 'google_oauth.identity_validated');
    stage = 'account_resolution';
    const linking = await currentUser();
    const allowed = linking && linking.id === saved.linkUserId && digest(linking.passwordHash ?? ('google:' + linking.googleId)) === saved.linkCredential ? linking : undefined;
    safeLog('info', 'google_oauth.callback_session', {
      cookiePresent: !!cookies().get('skillonit_session'),
      authenticated: !!linking,
      startedAuthenticated: !!saved.linkUserId,
      sameAccount: !!linking && linking.id === saved.linkUserId,
      credentialUnchanged: !!allowed,
      googleEmailMatches: !!linking && linking.email === email,
    });
    const user = await resolveGoogleUser({ sub: payload.sub, email, name: (payload.name || email.split('@')[0]).slice(0, 200), emailVerified: payload.email_verified === true, hostedDomain: payload.hd }, allowed);
    stage = 'session_creation';
    await signIn(user);
    stage = 'login_audit';
    await transaction(r => audit(r, user.id, 'auth.google_login', user.id));
    safeLog('info', 'google_oauth.session_created');
    res.redirect(303, new URL(saved.returnTo || '/', c.APP_URL).href);
  } catch (e) {
    const proofRequired = e instanceof ApiError && e.code === 'GOOGLE_EMAIL_PROOF_REQUIRED';
    safeLog('warn', 'google_oauth.callback_rejected', { stage, code: proofRequired ? 'GOOGLE_EMAIL_PROOF_REQUIRED' : 'GOOGLE_REJECTED' });
    res.status(proofRequired ? 409 : 400).json({ error: { code: proofRequired ? 'GOOGLE_EMAIL_PROOF_REQUIRED' : 'GOOGLE_REJECTED', message: proofRequired ? e.message : 'Google sign-in could not be completed. Start again from the login page.' } });
  }
});
