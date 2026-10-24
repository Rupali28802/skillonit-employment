import { module2Limit, module2Config } from './lib/module2-config.js';
import { getAutomation, saveAutomation } from './lib/student-preferences.js';
import { lookupCatalog, configureCatalog } from './lib/student-catalog.js';
import { profileCompletion, configureCompletion } from './lib/profile-completion.js';
import { atsCv } from './lib/ats-cv.js';
import express, { Router } from 'express';
import { z } from 'zod';
import { requestContext } from './request-context.js';
import { ApiError, requireUser, rateLimit, sameOrigin, audit, id } from './lib/security.js';
import { read, transaction } from './lib/store.js';
import { onboardingState, saveOnboarding, saveConsent, student, completeOnboarding, getConsents } from './lib/student-onboarding.js';
import { CV_MAX_BYTES, uploadCv, getCv, listCvs, deleteCv, confirmCv, retryCv, downloadCv } from './lib/cv-service.js';
import { configuredCvProviders, type CvProviders } from './lib/cv-providers.js';

const unavailable = () => new ApiError(503, 'CV_PROVIDER_UNAVAILABLE', 'Private CV storage, scanning and parsing are not configured. Use manual profile entry.');
const uploadsDisabled = () => new ApiError(503, 'CV_UPLOADS_DISABLED', 'CV uploads are temporarily unavailable while secure processing is being restored. You can continue using manual profile entry.');
export function createCvUploadRouter(resolveProviders: () => CvProviders | undefined = configuredCvProviders) {
  const router = Router();
  router.post('/api/v1/me/cv', (req, res, next) => requestContext.run({ request: req, response: res }, next),
    async (req, res, next) => {
      res.locals.correlationId = id(); res.setHeader('X-Request-Id', res.locals.correlationId);
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        sameOrigin(new Request('http://localhost/api/v1/me/cv', { method: 'POST', headers: { ...(req.get('origin') ? { origin: req.get('origin')! } : {}), 'sec-fetch-site': req.get('sec-fetch-site') || '' } }));
        const user = await requireUser('student');
        // A deliberately disabled upload path must not consume a rate-limit
        // slot or imply that credentials are absent. This preserves the safe
        // production gate while giving candidates an actionable message.
        if (process.env.ENABLE_CV_UPLOADS !== 'true') throw uploadsDisabled();
        if (!resolveProviders()) throw unavailable();
        await module2Limit(user.id, 'upload');
        res.locals.cvUserId = user.id;
        next();
      } catch (e) { next(e); }
    }, express.raw({ type: () => true, limit: module2Config().CV_MAX_BYTES }), async (req, res, next) => {
      try {
        const providers = resolveProviders(); if (!providers) throw unavailable();
        if (!Buffer.isBuffer(req.body)) throw new ApiError(400, 'CV_BODY', 'Send the CV file as the request body.');
        const data = await uploadCv(res.locals.cvUserId, req.get('x-file-name') || '', req.get('content-type')?.split(';')[0] || '', req.body, providers);
        res.status(202).json({ data, correlationId: res.locals.correlationId });
      } catch (e) { next(e); }
    });
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const large = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
    res.status(error instanceof ApiError ? error.status : large ? 413 : 503).json({ error: { code: error instanceof ApiError ? error.code : large ? 'CV_SIZE' : 'CV_UNAVAILABLE', message: error instanceof ApiError ? error.message : 'CV upload could not be completed.' }, correlationId: res.locals.correlationId });
  });
  return router;
}

export async function studentModuleRoute(p: string, method: string, body: () => Promise<unknown>, query = new URLSearchParams()) {
  if (p === 'admin/student-catalog' || p === 'admin/profile-completion') {
    const admin = await requireUser('admin'); await module2Limit(admin.id, 'admin');
    if (method !== 'PUT') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    return { data: p === 'admin/student-catalog' ? await configureCatalog(admin.id, await body()) : await configureCompletion(admin.id, await body()) };
  }
  if (p === 'taxonomy/occupations' || p === 'taxonomy/locations' || p === 'taxonomy/skills') {
    const actor = await requireUser(); await module2Limit(actor.id, 'lookup');
    if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    return { data: await lookupCatalog(p === 'taxonomy/occupations' ? 'occupations' : p === 'taxonomy/skills' ? 'skills' : 'locations', Object.fromEntries(query)) };
  }
  if (!['me/automation-preferences', 'me/profile/completion'].includes(p) && !/^me\/ats-cv(?:\/[^/]+(?:\/(?:confirm|export))?)?$/.test(p) && !['me/onboarding', 'me/onboarding/complete', 'me/consents', 'me/student-taxonomies', 'me/cv'].includes(p) && !/^me\/cv\/[^/]+(?:\/(?:confirm|retry|content))?$/.test(p)) return;
  const user = await requireUser('student');
  await module2Limit(user.id, method === 'GET' ? 'lookup' : 'mutation');
  if (p === 'me/profile/completion' && method === 'GET') return { data: await profileCompletion(user.id) };
  if (p === 'me/automation-preferences') {
    if (method === 'GET') return { data: await getAutomation(user.id) };
    if (method === 'PUT') return { data: await saveAutomation(user.id, await body()) };
  }
  if (p === 'me/ats-cv' && method === 'POST') return { data: await atsCv(user.id, undefined, 'create'), status: 201 };
  const ats = /^me\/ats-cv\/([^/]+)(?:\/(confirm|export))?$/.exec(p);
  if (ats) {
    if (!ats[2] && method === 'GET') return { data: await atsCv(user.id, ats[1], 'get') };
    if (!ats[2] && method === 'PUT') return { data: await atsCv(user.id, ats[1], 'edit', await body()) };
    if (ats[2] === 'confirm' && method === 'POST') return { data: await atsCv(user.id, ats[1], 'confirm', await body()) };
    if (ats[2] === 'export' && method === 'GET') return { data: await atsCv(user.id, ats[1], 'export') };
  }
  if (p === 'me/onboarding') {
    if (method === 'GET') return { data: await onboardingState(user.id) };
    if (method === 'PUT') return { data: await saveOnboarding(user.id, await body()) };
  }
  if (p === 'me/onboarding/complete' && method === 'POST') {
    return { data: await completeOnboarding(user.id) };
  }
  if (p === 'me/consents') {
    if (method === 'GET') return { data: await getConsents(user.id) };
    if (method === 'PUT') return { data: await saveConsent(user.id, await body()) };
  }
  if (p === 'me/student-taxonomies' && method === 'GET') {
    const row = await read(r => r.get<{ id: string; value: unknown }>('systemConfig', 'student-taxonomies'));
    const taxonomy = z.object({ version: z.string().max(100), roles: z.array(z.object({ id: z.string().max(100), label: z.string().max(200), relatedRoleIds: z.array(z.string().max(100)).max(100) })).max(1000), industries: z.array(z.string().max(200)).max(1000) });
    return { data: row ? taxonomy.parse(row.value) : { version: 'unconfigured', roles: [], industries: [] } };
  }
  if (p === 'me/cv' && method === 'GET') return { data: await listCvs(user.id) };
  const parts = p.split('/');
  if (parts[1] === 'cv' && parts[2]) {
    if (parts.length === 3 && method === 'GET') return { data: await getCv(user.id, parts[2]) };
    if (parts.length === 3 && method === 'DELETE') {
      // Check ownership even when the provider is offline.
      const receipt = await read(r => r.get<{ userId: string }>('cvDeletionReceipts', parts[2]));
      if (receipt?.userId === user.id) return { data: { deleted: true } };
      await getCv(user.id, parts[2]);
      const providers = configuredCvProviders(); if (!providers) throw unavailable();
      return { data: await deleteCv(user.id, parts[2], providers) };
    }
    if (parts[3] === 'retry' && method === 'POST') return { data: await retryCv(user.id, parts[2], await body()) };
    if (parts[3] === 'content' && method === 'GET') { const providers = configuredCvProviders(); if (!providers) throw unavailable(); return { data: await downloadCv(user.id, parts[2], providers) }; }
    if (parts[3] === 'confirm' && method === 'POST') return { data: await confirmCv(user.id, parts[2], await body()) };
  }
  throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
}
