import { requestContext } from './request-context.js';
import { getPreferences } from './lib/student-preferences.js';
import { randomBytes } from "node:crypto";
import { profileImage, mediaKinds } from './lib/profile-media.js';
import { z } from "zod";
import { read, transaction, demoMode, configuredPlans, type Row } from "./lib/store.js";
import {
  ApiError,
  id,
  digest,
  hashPassword,
  verifyPassword,
  signIn,
  signOut,
  currentUser,
  requireUser,
  safeUser,
  rateLimit,
  abuseLimits,
  sameOrigin,
  audit,
} from "./lib/security.js";
import {
  registerSchema,
  loginSchema,
  contactSchema,
  employerSchema,
  jobSchema,
  templateSchema,
} from "./lib/schemas.js";
import {
  type User,
  type Job,
  type ApplicationStatus,
  publicJob,
  eligibility,
  canTransition,
  isRecent,
} from "./lib/domain.js";
import { searchJobs } from "./lib/search.js";
import { engineStatus } from './job-engine/engine.js';
import { socialSourceSchema, ingestSocial } from './job-engine/social.js';
import { getMatches, runMatching, getRankingPolicy, configureRankingPolicy } from './lib/matching-engine.js';
import { matchingQuerySchema } from './lib/matching-contracts.js';
import { providerHealth, RazorpayProvider } from "./lib/providers.js";
import { featureRoute, notify } from "./features.js";
import { authMailConfig, sendAuthMail } from "./lib/auth-mail.js";
import { createEmailOtp, verifyEmailOtp, otpKey } from "./lib/email-otp.js";
import { issuePasswordReset, resetPassword, revokeSessions } from "./lib/auth-lifecycle.js";
import { getStudentProfileStatus, updateStudentProfile } from "./lib/student-profile.js";
import { studentModuleRoute } from "./student-module.js";
import { savePreferences } from "./lib/student-onboarding.js";
import { validateTaxonomyReferences } from './lib/student-catalog.js';
import {
  disconnectMailbox,
  mailboxStatus,
  requestMailboxConnection,
  verifyMailboxConnectionToken,
} from './mailbox-auth.js';
import {
  configureApplicationPolicy,
  applicationEligibility,
  createApplication,
  getApplicationPolicy,
  employerApplication,
  previewApplication,
  publicApplication,
  type ApplicationRecord as App,
} from './lib/application-engine.js';
import { assessEmployer, assessSource, persistJobFraudAssessment } from './lib/fraud-detection.js';
import { transitionJobLifecycle } from './lib/lifecycle.js';
import { activateStudentSubscription, cancelStudentSubscription, expireStudentSubscriptions, getStudentSubscription } from './lib/student-entitlements.js';
import { billingHistory, createPaymentOrder, processRazorpayWebhook, reconcilePayment, requestRefund, verifyCheckout } from './lib/payment-billing.js';
import { addApplicantNote, closeEmployerJob, createEmployerProfile, getEmployerApplicant, getEmployerJob, getEmployerProfile, getEmployerVerification, listApplicantNotes, listEmployerApplicants, recordEmployerVerificationDecision, submitEmployerVerification, updateApplicantStatus, updateEmployerJob, updateEmployerProfile } from './lib/employer-portal.js';
import { adminConsoleRoute } from './lib/admin-console.js';
export async function handle(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const context = requestContext.getStore();
  const correlationId = context?.response.locals.correlationId ?? id();
  if (context) context.response.locals.correlationId = correlationId;
  try {
    const parts = (await params).path,
      p = parts.join("/"),
      method = request.method,
      url = new URL(request.url);
    if (p !== 'webhooks/razorpay') sameOrigin(request);
    const limits = abuseLimits();
    const requester = request.headers.get("x-real-ip") || "local";
    await rateLimit(`request:${requester}`, limits.requests);
    if (method === "GET" || method === "HEAD")
      await rateLimit(`read:${requester}`, limits.reads);
    const ok = (data: unknown, status = 200) =>
      Response.json(
        { data, correlationId },
        {
          status,
          headers: {
            "Cache-Control": "private, no-store",
            "X-Request-Id": correlationId,
          },
        },
      );
    const body = async () => {
      const text = await request.text();
      if (text.length > 64000) throw new ApiError(413, "TOO_LARGE", "Request is too large.");
      try {
        return JSON.parse(text);
      } catch {
        throw new ApiError(400, "INVALID_JSON", "Please submit valid JSON.");
      }
    };
    if (p === "session" && method === "GET") {
      const user = await currentUser();
      return ok({ user: user ? safeUser(user) : null, demo: demoMode() });
    }
    if (p === "me/dashboard" && method === "GET") {
      const user = await requireUser("student");
      await rateLimit('matching:' + user.id, 30);
      const data = await read(async (r) => {
        const apps = await r.find("applications", { userId: user.id });
        const saved = await r.find("savedJobs", { userId: user.id });
        const plans = await configuredPlans();
        const result = await runMatching(r, user, { limit: 4 });
        const matches = result.items
          .map(({ job, match }) => ({ job: publicJob(job, user, plans), match }))
          .slice(0, 4);
        return { apps: (apps as App[]).map(publicApplication), saved, matches };
      });
      return ok(data);
    }
    if (p === 'me/subscription' && method === 'GET') {
      const user = await requireUser('student');
      return ok(await getStudentSubscription(user.id));
    }
    if (p === 'me/subscription/cancel' && method === 'POST') {
      const user = await requireUser('student');
      return ok(await cancelStudentSubscription(user.id));
    }
    if (p === 'health/live' && method === 'GET') return ok({ status: 'ok' });
    if (p === 'health/ready' && method === 'GET') {
      await read(r => r.count('systemConfig', {}));
      return ok({ status: 'ready' });
    }
    if (p === "health")
      return ok({
        status: "ok",
        mode: demoMode() ? "demo" : "production",
        providers: providerHealth(),
      });
    if (method !== "GET" && p !== 'webhooks/razorpay')
      await rateLimit(
        (p.startsWith("auth/") ? "auth:" : "write:") +
          (request.headers.get("x-real-ip") || "local"),
        p.startsWith("auth/") ? 20 : 120,
      );
    const studentResult = await studentModuleRoute(p, method, body, url.searchParams);
    if (studentResult) return ok(studentResult.data, studentResult.status || 200);
    const feature = await featureRoute(p, method, body);
    if (feature) return ok(feature.data, feature.status || 200);
    if (p === "auth/forgot-password" && method === "POST") {
      const { email } = z.object({ email: z.email().toLowerCase() }).parse(await body());
      await rateLimit("reset-account:" + email, 3);
      if (!demoMode()) authMailConfig();
      const token = await issuePasswordReset(email);
      if (!demoMode() && token) {
        try {
          await sendAuthMail(email, "reset-password", token);
        } catch {
          await transaction(async (r) => {
            const record = await r.get<{ userId: string }>("passwordResets", digest(token));
            if (record) await audit(r, record.userId, "auth.reset_delivery_failed", record.userId);
          });
        }
      }
      return ok({
        message:
          "If this account is eligible, recovery instructions have been requested. Please check your email or try again later.",
        ...(demoMode() && token ? { demoResetToken: token } : {}),
      });
    }
    if (p === "auth/reset-password" && method === "POST") {
      const input = z
        .object({
          token: z.string().min(20).max(200),
          password: z.string().min(12).max(128),
        })
        .parse(await body());
      await resetPassword(input.token, input.password);
      await signOut();
      return ok({
        reset: true,
        message: "Password changed. Please sign in again.",
      });
    }
    if (p === "auth/logout-all" && method === "POST") {
      const user = await requireUser();
      await transaction(async (r) => {
        await revokeSessions(r, user.id);
        await audit(r, user.id, "sessions.revoked", user.id);
      });
      await signOut();
      return ok({ signedOut: true });
    }
    if (p === "auth/register" && method === "POST") {
      const input = registerSchema.parse(await body());
      if (!demoMode()) authMailConfig();
      otpKey();
      let otp = "";
      const user: User = {
        id: id(),
        ...input,
        passwordHash: hashPassword(input.password),
        plan: "basic",
        verified: false,
        createdAt: new Date().toISOString(),
        profile: {
          name: input.name,
          headline: "",
          skills: [],
          experience: null,
          education: "",
          country: "",
          city: "",
          confirmed: false,
        },
        preferences: {
          roles: [],
          relatedRoles: [],
          countries: [],
          modes: [],
          exclusions: [],
          automation: false,
          dailyCap: 5,
        },
      };
      delete (user as unknown as Record<string, unknown>).password;
      try {
        await transaction(async (r) => {
          if ((await r.find<User>("users", { email: user.email })).length)
            throw new ApiError(409, "ACCOUNT_EXISTS", "An account already exists for this email.");
          await r.put("users", user);
          otp = await createEmailOtp(r, user.id);
          await audit(r, user.id, "account.registered", user.id);
        });
        const saved = await read(r => r.get<User>("users", user.id));
        if (!saved || saved.email !== user.email || saved.passwordHash !== user.passwordHash)
          throw new Error('Registration persistence confirmation failed');
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if ((error as { code?: number }).code === 11000)
          throw new ApiError(409, "ACCOUNT_EXISTS", "An account already exists for this email.");
        console.error('Registration database persistence failed; sensitive details withheld.');
        throw new ApiError(500, "PERSISTENCE_FAILED", "Unable to save registration. Please try again later.");
      }
      if (!demoMode()) {
        try {
          await sendAuthMail(user.email, "verify-email", otp);
          await transaction(r => audit(r, user.id, 'auth.verification_email_accepted', user.id));
        } catch (error) {
          // The committed account is retained so the user can request a new code.
          console.error('Registration verification delivery failed; account retained.');
          throw error;
        }
      }
      await signIn(user);
      return ok(
        {
          user: safeUser(user),
          ...(demoMode() ? { demoVerificationOtp: otp } : {}),
          message: demoMode()
            ? "Demo only: no email was sent. Use the test verification control."
            : "Check your email for the six-digit verification code.",
        },
        201,
      );
    }
    if (p === "auth/login" && method === "POST") {
      const input = loginSchema.parse(await body());
      await rateLimit("login-account:" + input.email, 5);
      const user = (await read((r) => r.find<User>("users", { email: input.email })))[0];
      if (!user || !verifyPassword(input.password, user.passwordHash) || user.disabled) {
        if (user) await transaction((r) => audit(r, user.id, "auth.login_failed", user.id));
        throw new ApiError(401, "INVALID_LOGIN", "Email or password is incorrect.");
      }
      await signIn(user);
      await transaction((r) => audit(r, user.id, "auth.login_succeeded", user.id));
      return ok({ user: safeUser(user) });
    }
    if (p === "auth/logout" && method === "POST") {
      await signOut();
      return ok({ signedOut: true });
    }
    if (p === "auth/resend-verification" && method === "POST") {
      const { email } = z.object({ email: z.email().toLowerCase() }).parse(await body());
      await rateLimit("verify-account:" + email, 3);
      if (!demoMode()) authMailConfig();
      otpKey();
      let otp = "";
      const recipient = await transaction(async (r) => {
        const user = (await r.find<User>("users", { email }, 1))[0];
        if (!user || user.disabled || user.verified) return null;
        otp = await createEmailOtp(r, user.id);
        return user;
      });
      if (recipient && !demoMode()) {
        try {
          await sendAuthMail(recipient.email, "verify-email", otp);
        } catch {
          await transaction((r) =>
            audit(r, recipient.id, "auth.verification_delivery_failed", recipient.id),
          );
        }
      }
      return ok({
        message: "If eligible, a verification code has been requested.",
        ...(demoMode() && recipient ? { demoVerificationOtp: otp } : {}),
      });
    }
    if (p === "auth/verify-email" && method === "POST") {
      const { email, otp } = z
        .object({ email: z.email().toLowerCase(), otp: z.string().regex(/^[0-9]{6}$/) })
        .strict()
        .parse(await body());
      await rateLimit("otp-verify-account:" + email, 10);
      await verifyEmailOtp(email, otp);
      return ok({ verified: true });
    }
    if (p === "auth/demo" && method === "POST") {
      if (!demoMode() || !["localhost", "127.0.0.1"].includes(url.hostname))
        throw new ApiError(404, "NOT_FOUND", "Not found.");
      const { role } = z
        .object({ role: z.enum(["student", "employer", "admin"]) })
        .parse(await body());
      const user: User = {
        id: "demo-" + role,
        name: "Demo " + role,
        email: `${role}@example.test`,
        role,
        plan: "pro",
        passwordHash: hashPassword(randomBytes(32).toString("hex")),
        verified: true,
        createdAt: new Date().toISOString(),
        profile: {
          name: "Demo candidate",
          headline: "Frontend developer",
          skills: ["React", "TypeScript", "CSS"],
          experience: 2,
          education: "Demonstration qualification",
          country: "India",
          city: "Bengaluru",
          confirmed: true,
        },
        preferences: {
          roles: ["Developer"],
          relatedRoles: ["Engineer"],
          countries: ["India"],
          modes: ["Hybrid", "Remote"],
          exclusions: [],
          automation: false,
          dailyCap: 5,
        },
      };
      await transaction(async (r) => {
        if (!(await r.get("users", user.id))) await r.put("users", user);
        await audit(r, user.id, "demo.session", user.id);
      });
      const stored = await read((r) => r.get<User>("users", user.id));
      if (!stored) throw new ApiError(401, "AUTH_REQUIRED", "Please sign in again.");
      await signIn(stored);
      return ok({ user: safeUser(stored) });
    }
    if (p === "me" && method === "GET")
      return ok({ user: safeUser(await requireUser()), demo: demoMode() });
    if (p === 'admin/job-engine' && method === 'GET') {
      await requireUser('admin');
      return ok(await engineStatus());
    }
    if (p === 'admin/social-sources' && method === 'POST') {
      const actor = await requireUser('admin');
      const source = socialSourceSchema.parse(await body());
      await transaction(async r => { await r.put('socialSources', source); await audit(r,actor.id,'social.source_configured',source.id); });
      return ok({id:source.id});
    }
    if (p === 'admin/social-posts' && method === 'POST') {
      const actor = await requireUser('admin');
      return ok(await ingestSocial(await body(), actor.id));
    }
    if (p === 'admin/social-posts' && method === 'GET') {
      await requireUser('admin');
      return ok(await read(r => r.page('socialPosts',{}, {updatedAt:-1,id:1},0,100)));
    }
    if (p === 'jobs/discovery-status' && method === 'GET') {
      const now = new Date(), today = new Date(now); today.setUTCHours(0,0,0,0);
      const sinceValue = url.searchParams.get('since');
      const since = sinceValue ? Date.parse(sinceValue) : NaN;
      return ok(await read(async r=> {
        const sources = await r.find<{id:string;intervalMinutes:number}>('jobFeedSources',{enabled:true,approved:true},1000);
        const states = new Map((await r.find<{id:string;lastSuccessAt?:string;failures:number}>('jobFeedStates',{},1000)).map(s=>[s.id,s]));
        const audit = await r.get<{countries:{indexedListings:number}[];generatedAt:string}>('jobEngineState','coverage-latest');
        const heartbeat = await r.get<{updatedAt:string}>('jobEngineState','discovery-heartbeat');
        const base={status:'published',sample:{$ne:true},expiresAt:{$gt:now.toISOString()}};
        return {sourcesOnline:sources.filter(s=>{const state=states.get(s.id);return state?.lastSuccessAt && !state.failures && now.getTime()-Date.parse(state.lastSuccessAt)<s.intervalMinutes*120000;}).length,
          workerOnline: !!heartbeat && now.getTime()-Date.parse(heartbeat.updatedAt)<600000,
          workerLastSeenAt: heartbeat?.updatedAt ?? null,
          detectedToday:await r.count('jobs',{...base,discoveredAt:{$gte:today.toISOString()}}),
          newJobs:await r.count('jobs',{...base,discoveredAt:{$gte:new Date(now.getTime()-600000).toISOString()}}),
          newSince: Number.isFinite(since) && since <= now.getTime() && since >= now.getTime()-86400000
            ? await r.count('jobs',{...base,discoveredAt:{$gt:new Date(since).toISOString(),$lte:now.toISOString()}}) : 0,
          countries:audit?.countries.filter(c=>c.indexedListings>0).length ?? null, measuredAt:now.toISOString(), countryAuditAt:audit?.generatedAt ?? null};
      }));
    }
    if (p === "jobs" && method === "GET")
      return ok(await searchJobs(url.searchParams, await currentUser()));
    if (p === "plans" && method === "GET")
      return ok({ plans: await configuredPlans(), pricesFinal: false });
    if (parts[0] === "jobs" && parts.length === 2 && method === "GET") {
      const job = await read((r) => r.get<Job>("jobs", parts[1]));
      if (!job || job.status !== "published")
        throw new ApiError(404, "NOT_FOUND", "This opportunity is not available.");
      return ok({
        ...publicJob(job, await currentUser(), await configuredPlans()),
        acceptingApplications: isRecent(job),
      });
    }
    if (parts[0] === "jobs" && parts[2] === "save" && method === "POST") {
      const u = await requireUser("student");
      const job = await read((r) => r.get<Job>("jobs", parts[1]));
      if (!job || job.status !== "published")
        throw new ApiError(404, "NOT_FOUND", "Job not found.");
      await transaction((r) =>
        r.put("savedJobs", {
          id: `${u.id}:${job.id}`,
          userId: u.id,
          jobId: job.id,
          createdAt: new Date().toISOString(),
        }),
      );
      return ok({ saved: true });
    }
    if (p === "me/saved" && method === "GET") {
      const u = await requireUser("student"),
        plan = await configuredPlans();
      return ok(
        await read(async (r) => {
          const saved = await r.find<{ jobId: string }>("savedJobs", {
            userId: u.id,
          });
          const jobs = await Promise.all(saved.map((s) => r.get<Job>("jobs", s.jobId)));
          return jobs
            .filter((j): j is Job => !!j && j.status === "published" && isRecent(j))
            .map((j) => publicJob(j, u, plan));
        }),
      );
    }
    if (parts[0] === 'me' && parts[1] === 'profile-image') {
      const user = await requireUser();
      return await profileImage(request, user, z.enum(mediaKinds).parse(parts[2]));
    }
    if (p === 'me/profile-appearance' && method === 'PUT') {
      const user = await requireUser();
      const { coverTheme } = z.object({ coverTheme: z.enum(['auto', 'technology', 'design', 'healthcare', 'finance', 'education', 'business']) }).parse(await body());
      await transaction(async r => {
        const latest = await r.get<User>('users', user.id);
        await r.put('users', { ...latest!, profile: { ...latest!.profile, coverTheme } });
        await audit(r, user.id, 'profile.appearance.updated', user.id);
      });
      return ok({ coverTheme });
    }
    if (p === "me/profile/status" && method === "GET") {
      const u = await requireUser("student");
      return ok(await getStudentProfileStatus(u.id));
    }
    if (p === "me/profile") {
      const u = await requireUser("student");
      if (method === "GET") return ok(u.profile);
      if (method === "PUT") {
        return ok(await updateStudentProfile(u.id, await body()));
      }
    }
    if (p === "me/preferences") {
      const u = await requireUser("student");
      if (method === "GET") return ok(await getPreferences(u.id));
      if (method === "PUT") {
        return ok(await savePreferences(u.id, await body()));
      }
    }
    if ((p === "me/matches" || p === "me/matches/details") && method === "GET") {
      const u = await requireUser("student");
      await rateLimit('matching:' + u.id, 30);
      const plans = await configuredPlans();
      const query = matchingQuerySchema.parse(Object.fromEntries(['q', 'limit', 'offset'].filter(k => url.searchParams.has(k)).map(k => [k, url.searchParams.get(k)])));
      const { items, ...metadata } = await getMatches(u.id, query);
      const results = items.map(({ job, match }) => ({ ...publicJob(job, u, plans), match }));
      return ok(p.endsWith('/details') ? { items: results, ...metadata } : results);
    }
    if (p === 'admin/matching-policy') {
      const actor = await requireUser('admin');
      if (method === 'GET') return ok(await read(getRankingPolicy));
      if (method === 'PUT') return ok(await configureRankingPolicy(actor, await body()));
    }
    if (p === "me/templates") {
      const u = await requireUser("student");
      if (method === "GET") return ok(await read((r) => r.get("applicationTemplates", u.id)));
      if (method === "PUT") {
        const template = templateSchema.parse(await body());
        const allowed = ["name", "job_title"];
        for (const t of [
          ...template.subject.matchAll(/\{\{(.*?)\}\}/g),
          ...template.body.matchAll(/\{\{(.*?)\}\}/g),
          ...template.signature.matchAll(/\{\{(.*?)\}\}/g),
        ])
          if (!allowed.includes(t[1]))
            throw new ApiError(
              400,
              "INVALID_VARIABLE",
              "Only {{name}} and {{job_title}} are supported.",
            );
        await transaction(async (r) => {
          await r.put("templateVersions", {
            id: id(),
            userId: u.id,
            ...template,
            createdAt: new Date().toISOString(),
          });
          await r.put("applicationTemplates", {
            id: u.id,
            ...template,
            updatedAt: new Date().toISOString(),
          });
          await audit(r, u.id, "template.updated", u.id);
        });
        return ok(template);
      }
    }
    if (p === "me/export" && method === "GET") {
      const u = await requireUser();
      return ok({
        user: safeUser(u),
        applications: (await read((r) => r.find<App>("applications", { userId: u.id }))).map(publicApplication),
        consents: u.preferences,
      });
    }
    if (p === "me/delete-request" && method === "POST") {
      const u = await requireUser();
      await transaction(async (r) => {
        await r.put("privacyRequests", {
          id: id(),
          userId: u.id,
          status: "pending",
          type: "deletion",
          createdAt: new Date().toISOString(),
        });
        await audit(r, u.id, "privacy.deletion_requested", u.id);
      });
      return ok({
        status: "pending",
        message: "Deletion request recorded for review, including any legally required retention.",
      });
    }
    if (p.startsWith("mail/")) {
      const u = await requireUser("student");
      if (p === "mail/status" && method === 'GET') return ok(await mailboxStatus(u.id));
      if (p === "mail/connect" && method === 'POST')
        return ok(await requestMailboxConnection(u));
      if (p === "mail/verify-connection" && method === 'POST') {
        const { token } = z.object({ token: z.string().min(1).max(256) }).strict().parse(await body());
        return ok(await verifyMailboxConnectionToken(u, token));
      }
      if (p === "mail/disconnect" && method === 'POST')
        return ok(await disconnectMailbox(u));
      throw new ApiError(
        404,
        "NOT_FOUND",
        "Mailbox endpoint not found.",
      );
    }
    if (p === "applications" && method === "GET") {
      const u = await requireUser("student");
      return ok((await read((r) => r.find<App>("applications", { userId: u.id }))).map(publicApplication));
    }
    if (p === "applications/preview" && method === "POST") {
      const u = await requireUser("student");
      return ok(await previewApplication(u.id, await body()));
    }
    if (p === 'applications/eligibility' && method === 'POST') {
      const u = await requireUser('student');
      return ok(await applicationEligibility(u.id, await body()));
    }
    if (p === "applications" && method === "POST") {
      const u = await requireUser("student");
      const result = await createApplication(u.id, await body());
      return ok({ ...publicApplication(result.application), externalUrl: result.externalUrl }, 201);
    }
    if (
      parts[0] === "applications" &&
      parts.length === 3 &&
      ["cancel", "open-external", "confirm-external", "withdraw"].includes(parts[2]) &&
      method === "POST"
    ) {
      const u = await requireUser("student");
      let openedExternalUrl: string | undefined;
      if (parts[2] === 'open-external') {
        const application = await read(r => r.get<App>('applications', parts[1]));
        if (!application || application.userId !== u.id || application.method !== 'external') throw new ApiError(404, 'NOT_FOUND', 'Application not found.');
        const job = await read(r => r.get<Job>('jobs', application.jobId));
        try { if (!job?.url || new URL(job.url).protocol !== 'https:') throw new Error(); openedExternalUrl = job.url; }
        catch { throw new ApiError(409, 'CANONICAL_ATS_URL_REQUIRED', 'A verified ATS destination is required.'); }
      }
      await transaction(async (r) => {
        const a = await r.get<App>("applications", parts[1]);
        if (!a || a.userId !== u.id) throw new ApiError(404, "NOT_FOUND", "Application not found.");
        const target: ApplicationStatus =
          parts[2] === "cancel"
            ? "CANCELLED"
            : parts[2] === 'open-external'
              ? 'EXTERNAL_STARTED'
            : parts[2] === "confirm-external"
              ? "EXTERNAL_SUBMITTED"
              : "WITHDRAWN";
        if (!canTransition(a.status, target))
          throw new ApiError(
            409,
            "INVALID_TRANSITION",
            "This application cannot move to that status.",
          );
        await r.put("applications", {
          ...a,
          status: target,
          events: [...a.events, { status: target, at: new Date().toISOString(), actorId: u.id }],
        });
        await audit(r, u.id, "application." + target.toLowerCase(), a.id);
      });
      if (parts[2] === 'open-external') {
        return ok({ updated: true, externalUrl: openedExternalUrl });
      }
      return ok({ updated: true });
    }
    if (p === "contact" && method === "POST") {
      const input = contactSchema.parse(await body());
      await transaction(async (r) => {
        const leadId = id();
        await r.put("leads", {
          id: leadId,
          ...input,
          status: "new",
          createdAt: new Date().toISOString(),
        });
        await audit(r, "visitor", "lead.created", leadId);
      });
      return ok(
        {
          message: "Your message has been recorded. Thank you for contacting SkillonIT.",
        },
        201,
      );
    }
    if (p === "reports" && method === "POST") {
      const u = await requireUser();
      const input = z
        .object({
          entityType: z.enum(['job', 'employer', 'source', 'destination']).default('job'),
          entityId: z.string().max(100),
          reason: z.string().min(10).max(3000),
        })
        .strict()
        .parse(await body());
      await transaction(async (r) => {
        const reportId = id();
        await r.put("fraudReports", {
          id: reportId,
          ...input,
          userId: u.id,
          status: "pending",
          createdAt: new Date().toISOString(),
        });
        if (input.entityType === 'job') {
          const job = await r.get<Job>('jobs', input.entityId);
          if (job) {
            const risk = await persistJobFraudAssessment(r, job);
            if (risk.riskLevel === 'high' || risk.riskLevel === 'blocked') {
              const transitioned = job.lifecycle?.state === 'active' ? await transitionJobLifecycle(r, job.id, 'publishing', u.id, 'FRAUD_REPORT_REVIEW') : job;
              await r.put('jobs', { ...transitioned, trust: 'flagged', status: 'review' });
            }
          }
        } else if (input.entityType === 'employer') {
          const employer = await r.get<any>('employers', input.entityId);
          if (employer) await r.put('entityRiskAssessments', await assessEmployer(r, employer));
        } else if (input.entityType === 'source') {
          const source = await r.get<any>('jobSources', input.entityId);
          if (source) await r.put('entityRiskAssessments', await assessSource(r, source));
        }
        await audit(r, u.id, "report.created", reportId);
      });
      return ok({ reported: true }, 201);
    }
    if (p === "employers") {
      const u = await requireUser("employer");
      if (method === "GET") return ok(await getEmployerProfile(u.id));
      if (method === "POST") return ok(await createEmployerProfile(u.id, await body()), 201);
      if (method === 'PUT') return ok(await updateEmployerProfile(u.id, await body()));
    }
    if (p === 'employer/verification') {
      const u = await requireUser('employer');
      if (method === 'GET') return ok(await getEmployerVerification(u.id));
      if (method === 'POST') return ok(await submitEmployerVerification(u.id, await body()));
    }
    if (p === "employer/jobs") {
      const u = await requireUser("employer");
      if (method === "GET") return ok(await read((r) => r.find<Job>("jobs", { employerId: u.id })));
      if (method === "POST") {
        const input = jobSchema.parse(await body());
        await read(r => validateTaxonomyReferences(r, { occupationId: input.matching?.occupationId, locationId: input.matching?.locationId }));
        const org = await read((r) =>
          r.get<{ name: string; domain: string; status: string }>("employers", u.id),
        );
        if (!org) throw new ApiError(409, "ORG_REQUIRED", "Create an organization profile first.");
        const job: Job = {
          ...input,
          id: id(),
          company: org.name,
          domain: org.domain,
          employerId: u.id,
            status: "review",
            trust: "pending",
          source: "Employer submission",
          discoveredAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
            revision: 0,
            updatedAt: new Date().toISOString(),
            lifecycle: { schemaVersion: 1, state: 'publishing', revision: 0, changedAt: new Date().toISOString(), reasonCode: 'EMPLOYER_SUBMITTED' },
        } as Job;
        await transaction(async (r) => {
          await r.put("jobs", job);
          await audit(r, u.id, "job.review_requested", job.id);
        });
        return ok(job, 201);
      }
    }
    if (parts[0] === 'employer' && parts[1] === 'jobs' && parts[2] && method === 'GET') {
      const u = await requireUser('employer'); return ok(await getEmployerJob(u.id, parts[2]));
    }
    if (parts[0] === 'employer' && parts[1] === 'jobs' && parts[2] && method === 'PUT') {
      const u = await requireUser('employer'); return ok(await updateEmployerJob(u.id, parts[2], await body()));
    }
    if (parts[0] === 'employer' && parts[1] === 'jobs' && parts[2] && parts[3] === 'close' && method === 'POST') {
      const u = await requireUser('employer'); return ok(await closeEmployerJob(u.id, parts[2]));
    }
    if (parts[0] === "employer" && parts[1] === "jobs" && parts[2] && method === "PATCH") {
      const u = await requireUser("employer");
      await transaction(async (r) => {
        const job = await r.get<Job>("jobs", parts[2]);
        if (!job || job.employerId !== u.id) throw new ApiError(404, "NOT_FOUND", "Job not found.");
        await transitionJobLifecycle(r, job.id, 'closed', u.id, 'EMPLOYER_CLOSED');
      });
      return ok({ closed: true });
    }
    if (p === "employer/applicants" && method === "GET") {
      const u = await requireUser("employer");
      const status = url.searchParams.get('status');
      const allowed = ['QUEUED','NEEDS_REVIEW','SENDING','SENT','EXTERNAL_STARTED','EXTERNAL_SUBMITTED','DIRECT_SUBMITTED','VIEWED','SHORTLISTED','INTERVIEW','OFFER','REJECTED','WITHDRAWN','CANCELLED','FAILED'] as const;
      if (status && !(allowed as readonly string[]).includes(status)) throw new ApiError(400, 'INVALID_STATUS', 'Applicant status is invalid.');
      return ok(await listEmployerApplicants(u.id, { jobId: url.searchParams.get('jobId') || undefined, status: status as ApplicationStatus | undefined }));
    }
    if (parts[0] === 'employer' && parts[1] === 'applicants' && parts[2] && parts.length === 3 && method === 'GET') {
      const u = await requireUser('employer'); return ok(await getEmployerApplicant(u.id, parts[2]));
    }
    if (parts[0] === 'employer' && parts[1] === 'applicants' && parts[2] && parts[3] === 'notes') {
      const u = await requireUser('employer');
      if (method === 'GET') return ok(await listApplicantNotes(u.id, parts[2]));
      if (method === 'POST') return ok(await addApplicantNote(u.id, parts[2], await body()), 201);
    }
    if (parts[0] === "employer" && parts[1] === "applicants" && parts[2] && method === "PATCH") {
      const u = await requireUser("employer");
      const { status, expectedStatus } = z
        .object({
          status: z.enum(["VIEWED", "SHORTLISTED", "INTERVIEW", "OFFER", "REJECTED"]),
          expectedStatus: z.enum(['DIRECT_SUBMITTED','VIEWED','SHORTLISTED','INTERVIEW']).optional(),
        })
        .strict()
        .parse(await body());
      const updated = await updateApplicantStatus(u.id, parts[2], status, expectedStatus);
      await transaction(async r => { const application = await r.get<App>('applications', parts[2]); if (application) await notify(r, application.userId, 'An employer updated your application', `${application.job.title}: ${status.replaceAll('_', ' ')}`, '/applications', 'application_status'); });
      return ok({ updated: true });
    }
    if (p === "billing/checkout" && method === "POST") {
      const u = await requireUser('student');
      const { planCode } = z
        .object({ planCode: z.enum(["basic", "pro", "premium"]) }).strict()
        .parse(await body());
      const idempotencyKey = request.headers.get('idempotency-key');
      if (!idempotencyKey) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required.');
      return ok(await createPaymentOrder(u, planCode, idempotencyKey, new RazorpayProvider()), 201);
    }
    if (p === 'billing/verify' && method === 'POST') {
      const u = await requireUser('student');
      return ok(await verifyCheckout(u.id, await body(), new RazorpayProvider()));
    }
    if (p === 'billing/history' && method === 'GET') {
      const u = await requireUser('student');
      return ok(await billingHistory(u.id));
    }
    if (p === "webhooks/razorpay" && method === "POST") {
      const raw = await request.text();
      if (raw.length > 100000) throw new ApiError(413, "TOO_LARGE", "Webhook is too large.");
      if (!new RazorpayProvider().verify(raw, request.headers.get("x-razorpay-signature") || ""))
        throw new ApiError(401, "INVALID_SIGNATURE", "Webhook signature is invalid.");
      let event: unknown;
      try { event = JSON.parse(raw); } catch { throw new ApiError(400, 'INVALID_JSON', 'Webhook payload is invalid.'); }
      const eventId = request.headers.get("x-razorpay-event-id");
      if (!eventId) throw new ApiError(400, "EVENT_ID_REQUIRED", "Event identifier required.");
      const subscriptionPlans = await configuredPlans();
      await transaction(async (r) => {
        await processRazorpayWebhook(r, eventId, event, subscriptionPlans);
      });
      return ok({ received: true });
    }
    if (parts[0] === "admin") {
      const u = await requireUser("admin");
      if (parts[1] === 'console') return ok(await adminConsoleRoute(u, parts, method, url.searchParams, body));
      if (parts[1] === 'student-subscriptions' && parts.length === 3 && method === 'PUT')
        return ok(await activateStudentSubscription(u, parts[2], await body()));
      if (p === 'admin/student-subscriptions/expire' && method === 'POST')
        return ok(await expireStudentSubscriptions());
      if (parts[1] === 'payments' && parts.length === 4 && parts[3] === 'refund' && method === 'POST')
        return ok(await requestRefund(u, parts[2], await body(), new RazorpayProvider()));
      if (parts[1] === 'payments' && parts.length === 4 && parts[3] === 'reconcile' && method === 'POST')
        return ok(await reconcilePayment(u, parts[2], new RazorpayProvider()));
      if (p === 'admin/application-policy') {
        if (method === 'GET') return ok(await getApplicationPolicy());
        if (method === 'PUT') return ok(await configureApplicationPolicy(u, await body()));
      }
      const allowed: Record<string, string> = {
        users: "users",
        employers: "employers",
        jobs: "jobs",
        sources: "jobSources",
        applications: "applications",
        fraud: "fraudReports",
        leads: "leads",
        payments: "payments",
        audit: "auditLogs",
        flags: "systemConfig",
        content: "content",
        queues: "queue",
        privacy: "privacyRequests",
      };
      if (p === "admin/overview")
        return ok({
          providers: providerHealth(),
          mode: demoMode() ? "Demo — local data only" : "Production",
          counts: await read(async (r) => ({
            jobs: await r.count("jobs"),
            users: await r.count("users"),
            applications: await r.count("applications"),
            leads: await r.count("leads"),
          })),
        });
      if (p === "admin/plans") {
        if (method === "GET") return ok(await configuredPlans());
        if (method === "PUT") {
          const input = z
            .array(
              z.object({
                code: z.enum(["basic", "pro", "premium"]),
                name: z.string().min(1).max(50),
                price: z.number().nonnegative().nullable(),
                currency: z.string().regex(/^[A-Z]{3}$/),
                dailyCap: z.number().int().min(0).max(100),
                delayMinutes: z.number().int().min(0).max(10080),
                identity: z.boolean(),
                autoApply: z.boolean(),
                cvs: z.number().int().min(1).max(20),
                autoApplyDailyCap: z.number().int().min(0).max(100).optional(),
                billingPeriodDays: z.number().int().min(1).max(366).default(30),
              }),
            )
            .length(3)
            .parse(await body());
          if (new Set(input.map((p) => p.code)).size !== 3)
            throw new ApiError(400, "INVALID_PLANS", "Provide each plan once.");
          await transaction(async (r) => {
            await r.put("systemConfig", { id: "plans", value: input });
            await audit(r, u.id, "plans.updated", "plans");
          });
          return ok(input);
        }
      }
      const collection = allowed[parts[1]];
      if (collection && method === "GET") {
        const rows = await read((r) => r.find<Row>(collection, {}, 200));
        if (collection === 'users') return ok(rows.map(row => safeUser(row as unknown as User)));
        if (collection === 'applications') return ok(rows.map(row => publicApplication(row as unknown as App)));
        if (collection === 'payments') return ok(rows.map(({ providerPaymentId: _payment, providerOrderId: _order, signature: _signature, ...row }) => row));
        if (collection === 'systemConfig') return ok(rows.map(row => ({ id: row.id, revision: row.revision ?? 0 })));
        if (collection === 'auditLogs') return ok(rows.map(row => ({ id: row.id, actorId: row.actorId, action: row.action, entityId: row.entityId, entityType: row.entityType, correlationId: row.correlationId, createdAt: row.createdAt ?? row.timestamp })));
        return ok(rows);
      }
      if (collection && method === "PATCH" && parts[2]) {
        const change = z
          .object({
            status: z.enum([
              "verified",
              "rejected",
              "published",
              "disabled",
              "closed",
              "resolved",
              "contacted",
              "pending",
              "review",
            ]),
            note: z.string().max(2000).optional(),
          })
          .parse(await body());
        await transaction(async (r) => {
          const row = await r.get<Row>(collection, parts[2]);
          if (!row) throw new ApiError(404, "NOT_FOUND", "Record not found.");
          if (collection === "jobs" && change.status === "published") {
            const org = await r.get<Row>("employers", String(row.employerId));
            if (org?.status !== "verified")
              throw new ApiError(
                409,
                "VERIFICATION_REQUIRED",
                "Verify the organization before publishing.",
              );
            const assessment = await persistJobFraudAssessment(r, row as unknown as Job);
            if (assessment.riskLevel === 'high' || assessment.riskLevel === 'blocked')
              throw new ApiError(409, 'FRAUD_REVIEW_REQUIRED', 'Complete fraud review before publishing this job.');
          }
          if (collection === 'employers' && change.status === 'verified') {
            const assessment = await assessEmployer(r, { ...(row as any), status: 'verified' });
            if (assessment.riskLevel === 'high' || assessment.riskLevel === 'blocked')
              throw new ApiError(409, 'FRAUD_REVIEW_REQUIRED', 'Resolve employer fraud signals before verification.');
            await r.put('entityRiskAssessments', assessment);
          }
          const allowedStatuses: Record<string, string[]> = {
            jobs: ["published", "disabled", "closed", "review"],
            employers: ["verified", "rejected", "pending"],
            leads: ["contacted", "resolved"],
            fraudReports: ["resolved", "rejected"],
            privacyRequests: ["pending", "resolved"],
          };
          if (!allowedStatuses[collection]?.includes(change.status))
            throw new ApiError(
              400,
              "INVALID_ACTION",
              "This action is not permitted for this resource.",
            );
          if (collection === 'jobs') {
            const target = change.status === 'published' ? 'active' : change.status === 'disabled' ? 'removed' : change.status === 'closed' ? 'closed' : 'publishing';
            if (change.status === 'published') await r.put('jobs', { ...(row as any), trust: 'verified' });
            await transitionJobLifecycle(r, row.id, target, u.id, change.status === 'published' ? 'ADMIN_PUBLISHED' : change.status === 'disabled' ? 'ADMIN_REMOVED' : change.status === 'closed' ? 'ADMIN_CLOSED' : 'ADMIN_REVIEW');
            return;
          }
          if (collection === 'employers') {
            await recordEmployerVerificationDecision(r, row.id, u.id, change.status as 'verified' | 'rejected' | 'pending', change.note);
            return;
          }
          await r.put(collection, {
            ...row,
            ...change,
            ...(collection === "jobs" && change.status === "published"
              ? { trust: "verified" }
              : {}),
          });
          await audit(r, u.id, collection + "." + change.status, row.id);
        });
        return ok({ updated: true });
      }
    }
    throw new ApiError(404, "NOT_FOUND", "The requested endpoint was not found.");
  } catch (error) {
    const known = error instanceof ApiError;
    const validation = error instanceof z.ZodError;
    const status = known ? error.status : validation ? 400 : 503;
    const classification = status === 401 || status === 403 ? 'authorization' : status === 409 ? 'conflict' : status === 429 ? 'rate_limit' : status >= 500 ? 'dependency' : 'request';
    console.info('API request rejected', { correlationId, status, classification });
    return Response.json(
      {
        error: {
          classification, retryable: status === 429 || status >= 500,
          code: known ? error.code : validation ? "VALIDATION_ERROR" : "SERVICE_UNAVAILABLE",
          message: known
            ? error.message
            : validation
              ? error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")
              : "This service is temporarily unavailable. Please try again later.",
        },
        correlationId,
      },
      {
        status: known ? error.status : validation ? 400 : 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": correlationId,
          ...(status === 429 ? { "Retry-After": "60" } : {}),
        },
      },
    );
  }
}
