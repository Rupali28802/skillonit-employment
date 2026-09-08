import { googleAuth } from './google-auth.js';
import { isLocalPreviewOrigin } from './lib/runtime-config.js';
import express, { type ErrorRequestHandler } from 'express';
import { handle } from './api.js';
import { requestContext } from './request-context.js';

export const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
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
app.use('/api/v1/auth', googleAuth);
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
        console.info('Auth session transport', {
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
    .json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
});
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  const large = error?.type === 'entity.too.large';
  res
    .status(large ? 413 : 503)
    .json({
      error: {
        code: large ? 'TOO_LARGE' : 'SERVICE_UNAVAILABLE',
        message: large
          ? 'Request is too large.'
          : 'This service is temporarily unavailable. Please try again later.',
      },
    });
};
app.use(errors);
