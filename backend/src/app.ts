import { googleAuth } from './google-auth.js';
import { mailboxAuth } from './mailbox-auth.js';
import { isLocalPreviewOrigin } from './lib/runtime-config.js';
import { createCvUploadRouter } from './student-module.js';
import express, { type ErrorRequestHandler } from 'express';
import { handle } from './api.js';
import { requestContext } from './request-context.js';
import { randomUUID } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import { prometheusMetrics, recordHttpObservation, recordIncidentSignal, routeGroup } from './lib/observability.js';
import { safeLog } from './lib/safe-logger.js';

export const app = express();
app.disable('x-powered-by');
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(proxyHops) && proxyHops > 0 && proxyHops <= 3) app.set('trust proxy', proxyHops);
app.use((req, res, next) => {
  const requestStarted = performance.now();
  res.locals.correlationId = randomUUID();
  res.set({
    'X-Request-Id': res.locals.correlationId,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  if (process.env.NODE_ENV === 'production' && process.env.APP_URL?.startsWith('https://')) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.on('finish', () => {
    const durationMs = Math.max(0, Math.round(performance.now() - requestStarted)), group = routeGroup(req.originalUrl.split('?')[0]);
    recordHttpObservation(req.method, group, res.statusCode, durationMs);
    safeLog(res.statusCode >= 500 ? 'error' : res.statusCode === 429 ? 'warn' : 'info', 'http.request_completed', { correlationId: res.locals.correlationId, method: req.method, routeGroup: group, status: res.statusCode, statusClass: `${Math.floor(res.statusCode / 100)}xx`, durationMs });
    if (res.statusCode >= 429) void recordIncidentSignal({ correlationId: res.locals.correlationId, routeGroup: group, status: res.statusCode, durationMs, classification: res.statusCode === 429 ? 'rate_limit' : res.statusCode >= 500 ? 'dependency' : 'request' }).catch(() => safeLog('error', 'incident.signal_persist_failed', { correlationId: res.locals.correlationId }));
  });
  const origin = req.get('origin');
  if (origin && (origin === (process.env.APP_URL || 'http://localhost:3000') || isLocalPreviewOrigin(origin))) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    });
    res.vary('Origin');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(
      origin && origin !== (process.env.APP_URL || 'http://localhost:3000') && !isLocalPreviewOrigin(origin)
        ? 403
        : 204,
    );
    return;
  }
  next();
});
app.get('/internal/metrics', (req, res) => {
  const secret = process.env.OBSERVABILITY_METRICS_TOKEN || '', supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const authorized = secret.length >= 32 && supplied.length === secret.length && timingSafeEqual(Buffer.from(secret), Buffer.from(supplied));
  if (!authorized) { res.status(secret ? 401 : 404).set('Cache-Control', 'no-store').send(secret ? 'Unauthorized' : 'Not found'); return; }
  res.set({ 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' }).send(prometheusMetrics());
});
app.use('/api/v1/auth', googleAuth);
app.use('/api/v1/mail', mailboxAuth);
app.use(createCvUploadRouter());
app.get('/api/v1/jobs/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write('event: ready\ndata: {"connected":true}\n\n');
  const timer = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  res.on('close', () => clearInterval(timer));
});
// Keep bytes unchanged for payment webhook signatures; business parsing is in the handler.
app.use('/api/v1/me/profile-image', express.raw({ type: () => true, limit: '2mb' }));
app.use(
  '/api/v1',
  express.raw({ type: () => true, limit: '64kb' }),
  async (req, res) => {
    await requestContext.run({ request: req, response: res }, async () => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      // Do not trust a client-supplied IP header for throttling.
      headers.set('x-real-ip', req.ip || req.socket.remoteAddress || 'local');
      const url = new URL(
        req.originalUrl,
        `http://${req.get('host') || 'localhost'}`,
      );
      const request = new Request(url, {
        method: req.method,
        headers,
        ...(!['GET', 'HEAD'].includes(req.method) && req.body?.length
          ? { body: new Uint8Array(req.body) }
          : {}),
      });
      const response = await handle(request, {
        params: Promise.resolve({
          path: url.pathname
            .slice('/api/v1/'.length)
            .split('/')
            .filter(Boolean),
        }),
      });
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (url.pathname === '/api/v1/auth/login' || url.pathname === '/api/v1/session') {
        const result = await response.clone().json().catch(() => null);
        const outgoing = res.getHeader('set-cookie');
        const sessionCookie = (Array.isArray(outgoing) ? outgoing : outgoing ? [String(outgoing)] : [])
          .find(value => value.startsWith('skillonit_session='));
        // Fixed labels and booleans only; never log request bodies or cookie values.
        safeLog('info', 'auth.session_transport', {
          endpoint: url.pathname === '/api/v1/auth/login' ? 'login' : 'session',
          status: response.status,
          incomingSessionCookie: /(?:^|;\s*)skillonit_session=/.test(req.headers.cookie || ''),
          authenticated: !!result?.data?.user,
          sessionCookieSet: !!sessionCookie,
          secure: !!sessionCookie && /;\s*Secure/i.test(sessionCookie),
          httpOnly: !!sessionCookie && /;\s*HttpOnly/i.test(sessionCookie),
          sameSiteLax: !!sessionCookie && /;\s*SameSite=Lax/i.test(sessionCookie),
        });
      }
      res
        .status(response.status)
        .send(Buffer.from(await response.arrayBuffer()));
    });
  },
);
app.use((_req, res) => {
  res
    .status(404)
    .json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.', classification: 'request', retryable: false }, correlationId: res.locals.correlationId });
});
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  const large = error?.type === 'entity.too.large';
  res
    .status(large ? 413 : 503)
    .json({
      error: {
        code: large ? 'TOO_LARGE' : 'SERVICE_UNAVAILABLE',
        classification: large ? 'request' : 'dependency',
        retryable: !large,
        message: large
          ? 'Request is too large.'
          : 'This service is temporarily unavailable. Please try again later.',
      },
      correlationId: res.locals.correlationId,
    });
};
app.use(errors);
