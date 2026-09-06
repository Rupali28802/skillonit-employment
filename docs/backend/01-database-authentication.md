# Backend module 1 — Database architecture and authentication

Branch: `codex/backend-foundation`, based on `codex/enterprise-portal`.
This module stays in the existing task and repository. Modules 2–10 are not part of this change. Preserve the existing frontend design and the independent frontend start-script fix.

## Implementation prompt and scope

Extend the existing Express/TypeScript backend and MongoDB repository incrementally. Preserve registration, login, email verification, student/employer/admin authorization, sessions and existing API contracts. Add password recovery, session invalidation, indexed account throttling and authentication audit events. Keep raw credentials and bearer tokens out of persistence, logs and commits. Test failure paths, ownership and concurrent one-time token use with both the isolated local adapter and a real isolated MongoDB replica set. Do not mark production email delivery complete without a working provider.

## Architecture

```
backend/src/
  api.ts                    HTTP validation, authorization and response envelope
  request-context.ts        Request-local HttpOnly cookie transport
  lib/
    schemas.ts              Zod input contracts
    security.ts             Password hashing, sessions, RBAC, rate limits, audit
    auth-lifecycle.ts        Password reset and paginated session revocation
    store.ts                Repository, transaction boundaries, bootstrap indexes
backend/tests/
  auth.test.ts              Isolated API/security regression suite
  mongo-integration.ts      Replica-set indexes, transactions and API checks
```

Production persistence requires MongoDB with transaction support (replica set). `MONGODB_URI` and optional `MONGODB_DATABASE` select the database. The JSON adapter is explicitly demo-only and cannot provide multi-process production safety. Profile/preferences currently remain embedded in users; splitting them is a later profile-module decision, not an automatic rewrite.

## Auth data and indexes

| Collection | Data / access pattern | Indexes |
|---|---|---|
| users | Normalized email, scrypt hash, role, disabled status, profile | Unique id/email; role + disabled + id |
| sessions | SHA-256 token id, owner, credential digest, expiry | Unique id; userId + id; expiry Date TTL |
| verifications | Hashed one-use email token, owner, expiry | Unique id; expiry Date TTL |
| passwordResets | Hashed one-use reset token, owner, 30-minute expiry | Unique id/userId; expiry Date TTL |
| rateLimits | Hashed action/account/minute key, counter | Unique id; expiry Date TTL |
| auditLogs | Actor, action, entity, timestamp | Unique id; actorId + createdAt |

Index bootstrap is additive and idempotent at server startup. Back up before production rollout and test indexes against a staging replica set. Existing documents without `expiresAtDate` are not retroactively TTL-deleted; application expiry checks still reject expired credentials. Review/backfill historical verification and rate-limit rows in a separately reviewed migration. TTL removal is asynchronous and never substitutes for expiry validation.

Existing sessions without a credential digest remain compatible; password reset explicitly removes them. New sessions bind to the current password hash and reject stale sign-in snapshots. Session tokens last seven days and use HttpOnly, SameSite=Lax cookies with Secure in production.

## Endpoints

| Endpoint | Behavior |
|---|---|
| POST auth/register | Existing demo registration; public admin creation forbidden |
| POST auth/login | Existing password login plus account/minute throttle and safe audit |
| POST auth/verify-email | One-use token; rejects expired, malformed-expiry and disabled accounts |
| POST auth/forgot-password | Demo reset issuance; newest token replaces the previous token |
| POST auth/reset-password | Validates password, consumes token and revokes all sessions atomically |
| POST auth/logout-all | Authenticated owner-only paginated session deletion and cookie clearing |

All paths use `/api/v1/`. Recovery does not mark email verified, elevate roles or sign users in automatically. Reset completion does not need a pre-existing login. Tokens are never written into audit events.

## Test coverage

`npm test`: reset/replay/expiry, invalid passwords, session revocation beyond 250 rows, other-user isolation, forbidden admin signup, old-password rejection, token replacement, concurrent consumption, account throttling, audit redaction, repeated demo login, and fail-closed unconfigured persistence.

`npm run test:mongo`: existing independent API/feature suites plus new TTL-index assertions and concurrent reset consumption/session revocation against MongoDB transactions. Tests use synthetic credentials generated in memory and isolated databases.

## Explicit remaining requirements

- SMTP authentication email adapter and verification/recovery pages now exist. Live SMTP delivery, sender-domain verification and production MongoDB connection are not yet validated. Durable delivery retries remain unimplemented; users can request replacement links. Recovery/resend return generic responses, but timing-based account enumeration resistance has not been established.
- Demo responses deliberately expose test verification/reset tokens and may reveal test account existence. Never enable DEMO_MODE on an internet-facing deployment.
- Account throttling is a basic suspicious-login control, not full device-risk detection, MFA, compromise notifications or administrator session policy.
- Password hashing remains synchronous scrypt from the existing implementation; production throughput benchmarking and a bounded asynchronous hashing pool remain hardening work.
- Large-scale Mongo query-plan/load tests, schema validator rollout and historical TTL backfill remain outstanding. No claim of million-user capacity or production deployment is made.

Module 2 (student profile and CV/resume) begins only in the next requested step.

## Real database and email setup

Keep the working demo configuration until live providers have been checked. Store credentials only in ignored `backend/.env`. Never put connection strings in tickets or commits.

1. Configure `MONGODB_URI` and `MONGODB_DATABASE` for an Atlas cluster or a local replica set. Run `npm run db:check` from backend. This read-only probe checks reachability and replica-set/sharded topology without printing driver error details or credentials.
2. Configure `ENABLE_AUTH_EMAIL=true`, `SMTP_HOST`, `SMTP_PORT` (465 or 587), `SMTP_USER`, `SMTP_PASSWORD`, and `AUTH_EMAIL_FROM`. Use a sender authorized by your email provider. Set `APP_URL` to the public HTTPS origin. Configuration validation alone does not establish deliverability.
3. SMTP uses certificate validation, TLS/required STARTTLS, timeouts, disabled debug logs and no attachment file/URL access. See https://nodemailer.com/smtp for transport behavior.
4. Verify with synthetic accounts in staging before setting `DEMO_MODE=false` in production. Do not switch the current localhost preview to a public origin; use separate staging configuration.
5. Email links use fragments rather than query parameters. The verification/reset pages read and clear the fragment, require an explicit form submission, and retain the existing UI style. Refreshing clears the in-memory token; reopen the original email link.

`auth/resend-verification` is account-rate-limited and available after failed signup delivery. Signup stores the unverified account before sending; if SMTP fails, no session is issued and the user can request another verification link. SMTP acceptance does not guarantee inbox delivery. Real mailbox and database provider testing remain pending until secure local configuration is available.
