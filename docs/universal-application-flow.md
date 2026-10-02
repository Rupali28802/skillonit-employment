# Universal application flow — implementation and release limits

This change extends the existing Application Engine. It is local, not deployed. It does not change Google Login OAuth, add a mailbox OAuth flow, contact real recruiters, or alter live workers/databases.

## Existing architecture reused

- `backend/src/lib/application-engine.ts`: eligibility, immutable submission snapshot, scheduling, application collection, and sender.
- `backend/src/mailbox-auth.ts`: separate Gmail Send OAuth, one Gmail scope (`gmail.send`), encrypted refresh tokens, MIME CV attachment, and Gmail `users/me/messages/send`.
- `student-entitlements.ts`: configured plans, atomic per-user/day credit counters and subscription resolution.
- `cv-service.ts` / `cvVersions`: owned, confirmed CVs; original supported stored document or the existing confirmed-profile text attachment.
- `admin-console.ts` / `admin-rbac.ts`: existing applications permission and cursor pagination.
- Existing application business-key unique constraints and transactional MongoDB/PostgreSQL repository.
- Master Specification sections on email delivery, external ATS handoffs, direct applications, immutable snapshots, and truthful tracking.

## Implemented behavior

Canonical `email`, `external`, and `direct` methods project to EMAIL, EXTERNAL_FORM, and SKILLONIT. Explicit ATS or unrecognized method values fail closed; a hostname does not imply submission support.

After candidate confirmation, missing eligibility produces a durable NEEDS_REVIEW application with safe reasons and no new credit charge. Fixing prerequisites and confirming again reuses the same record. Submitted/cancelled records are not resubmitted. A deterministic ID supplements the existing unique candidate/job business key for concurrent first submissions.

Direct/email delivery continues through the existing queue. `ENABLE_APPLICATION_ENGINE` must be enabled for production delivery. Workers recheck role, verification, current job availability, fraud, approved CV ownership, consent, and applicable entitlements. Email uses the frozen destination/template/CV and appends job/application references. Gmail acceptance and its message ID are necessary for SENT/SUBMITTED. Acceptance does not imply inbox delivery, recruiter acknowledgment, or an offer.

Definite failures and cancellations before sending release charged credits once. Unknown Gmail outcomes retain the reservation and block retry. An expired Gmail sender lease becomes NEEDS_REVIEW; no resend occurs with send-only scope because the engine cannot query Sent. Direct writes are transactional, so an abandoned direct claim can be requeued safely.

The existing recruiter statuses remain compatible. A separate `submissionState` projection exposes READY, SUBMITTING, SUBMITTED, CONFIRMED, NEEDS_REVIEW, FAILED, and CANCELLED. A Gmail acceptance stays SUBMITTED; it is not fabricated as recruiter-confirmed. DRAFT is reserved in the presentation vocabulary; this change does not add a candidate draft editor or fabricate form-progress states.

Application list responses use an explicit allowlist. Owner/admin detail endpoints expose only approved metadata: CV/version identifiers, profile revision, template timestamp/version, recipient, subject, timestamps, masked provider ID, and safe events. No tokens, raw snapshots, CV URLs, private message bodies, or provider error payloads appear in those responses. Existing immutable snapshot/retention behavior is retained.

Candidate My Applications gains method, submission state, update time, review reasons, details, and confirmation-based retry/cancel controls. Admin Applications gains method/status filters, candidate/job/employer search, safe details, and cursor paging without the old first-1,000-record truncation. Admin cannot send or rewrite applications.

## External forms and ATS: explicit limitation

There is no existing form submission adapter or ATS application submission provider in this repository. Discovery feeds and ATS job URLs are not submission APIs. All such destinations remain NEEDS_REVIEW with a safe source handoff. No form is submitted automatically and no fields are claimed as submitted. An explicit candidate report is labeled `candidate_reported`, never provider-verified.

The confirmed-field mapping helper recognizes known label synonyms and returns missing fields. It does not infer phone numbers from free text, guess salary/work authorization, inspect arbitrary third-party pages, or submit a form. CV references require matching ownership and confirmation. It is an internal mapping boundary, not a configured external integration.

To enable an actual external/ATS adapter, supply an authorized provider contract and supported destinations, real credentials if required, documented field schemas/CV upload constraints, submission evidence, timeout/idempotency rules, and an approved test destination. A separate cover-letter artifact/requirement is not represented by the existing Job model; approved application templates remain the supported content source.

## Configuration and release blockers

- Local `.env` contains Gmail client/secret/callback/encryption entries; presence does not validate credentials or production OAuth redirects.
- Local `.env` has no `ENABLE_APPLICATION_ENGINE` entry. It was not enabled by this change.
- Verify the deployed worker configuration, queue health, real Gmail authorization, and a user-approved recipient before a real delivery test. No live email was sent in this task.
- External/ATS submission and FORM_DETECTED/AUTO_FILLING progression remain unavailable until a real supported adapter exists.
- Tests use isolated MongoDB replica sets and simulated provider responses. Production PostgreSQL delivery/concurrency still needs environment-specific verification before deployment/cutover.
- Browser runtime validation of the local build is subject to the local-server execution restriction; build success is not browser verification.

## Validation commands

- `npm test` (backend)
- `node --import tsx --test tests/universal-application.test.ts tests/application-engine.test.ts`
- `npm run test:mongo` (isolated database plus API/feature integration suites)
- `npm run typecheck` and `npm run build` (backend)
- `npm run typecheck`, `npm run lint`, `npm run build` (frontend, alternate build output)

The universal integration suite exercises disconnected Gmail, accepted and rejected sends, uncertain sends, expired claims, same-job concurrency, duplicate credits, definite-failure credit release, cancellation, exhausted allowance, direct application, unsupported external/ATS methods, candidate ownership, employer visibility, admin RBAC/search/filter/details, safe metadata, and audit events. Provider responses are simulated only within tests; successful live Gmail/ATS submission is not claimed.

## Results — 30 September 2026

Files changed for this scope (pre-existing Employer/migration changes were preserved):

- Backend: `src/lib/application-engine.ts`, new `src/lib/application-routing.ts`, `src/mailbox-auth.ts`, `src/lib/admin-console.ts`, `src/api.ts`.
- Frontend: new `components/application-details.tsx`, `components/job-actions.tsx`, `components/workspace.tsx`, `components/admin-console-panel.tsx`, `app/globals.css`.
- Tests: new `tests/universal-application.test.ts`, `tests/application-engine-checks.ts`, `tests/features.mjs`.
- Documentation: this report.

| Check | Result |
| --- | --- |
| Full backend regression suite | 200 passed, 0 failed |
| Final targeted application suites | 6 passed, 0 failed; includes expanded HTTP/concurrency scenarios |
| Isolated MongoDB + API/feature integration | Passed, including password/session/OAuth-state-binding regressions |
| Backend TypeScript and production build | Passed |
| Frontend TypeScript, lint, production build | Passed |
| Live Gmail delivery and Gmail Sent | Not tested; no real email sent |
| Supported form/ATS submission | Blocked: no submission adapter/provider installed |
| Production PostgreSQL application delivery | Not tested in this task |
| Local UI browser validation | Blocked: automatic approval review rejected frontend server startup with “blocked by policy” |

The broader integration suite initially failed because its external-handoff fixture lacked verified employer/domain data and triggered FRAUD_RISK. The fixture now represents a verified destination; production fraud checks were preserved. Quota integration expectations were updated to require two durable attempts, one successful reservation, and one NEEDS_REVIEW record. The frontend build used `.next-employer-check`; generated TypeScript include changes were removed afterward. No commits, pushes, deployment, real recruiter messages, or live worker changes were performed.
