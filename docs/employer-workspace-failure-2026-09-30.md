# Employer workspace failure — 30 September 2026

## Authorized narrow deployment — 07:11:51 UTC

The subsequent production-completion instruction explicitly authorized deploying this tested query fix. It was applied against the freshly verified live adapter SHA256 `840654b1f9527bc47b4e9096f2c2a821ca87db5b208edff2c56dbd087506970a`, in isolated AWS staging. Only postgres-store and postgres-read-filter source/compiled files were installed. The API service was restarted; frontend, worker processes, Atlas, environment and application data were unchanged. Existing startup index initialization still runs normally.

Release and rollback: `/home/ubuntu/skillonit-releases/employer-read-20260930`; exact installed hashes are in `deployed.json`, previous files in `rollback`. Rollback restores the previous postgres-store source/compiled files, removes the two newly introduced helper files, then restarts only `skillonit-employment-backend`. Do not roll back unrelated payment changes.

Fresh checks:

- Actual AWS release typecheck and production build passed.
- Three filter regression tests passed against that release.
- Four read-only PostgreSQL CTE checks passed; real-owner read returned zero jobs in 460 ms, matching SQL count and ownership checks.
- Six local regression tests passed (Employer portal, HTTP workspace, role login and filter tests). These test local broader implementation and are not proof that all local features were deployed.
- Public readiness returned 200; API active with NRestarts=0 and approximately 72 MB systemd MemoryCurrent during post-release checks.
- Existing authorized Employer session: overview reload, navigation to jobs, organization, applicants, billing and post-a-job rendered. API Employer reads returned 200 in 301/317 ms. Browser captured error/warning log list was empty during inspected navigation.
- Company is unsubmitted and account has no owned jobs. Applicants correctly shows empty state. No profile, job, applicant, role, payment or email mutation was performed.

Phase 1 is **PARTIAL**, not accepted. Current production frontend still uses the older Employer workspace: billing reports commercial configuration required, team invitations are unavailable, and newer draft/edit/pause/settings/notification UI is not deployed. A fresh password/Google login, live ownership attacks, live role-change/relogin, job and applicant mutations, and responsive full acceptance remain unverified. User was asked for approved real company/vacancy information; no fake production fixtures were created. Later phases have not been advanced past this gate.

Additional release-review finding: the prepared Employer implementation uses `$nin` in applicant list/count filters (`backend/src/lib/employer-portal.ts`, applicantScope and employerPage). The current deployed PostgreSQL matcher does not implement `$nin`; unknown object operators fall through its range checks. The narrow equality-read hotfix intentionally does not change that behavior. Before deploying the broader Employer module, add and test compatible exclusion semantics and review transaction-backed expectedRevision checks against PostgreSQL concurrency. Passing MongoDB-backed Employer tests alone does not establish PostgreSQL compatibility for these paths. This is an engineering blocker independent of the missing approved company/vacancy test data.

## Root cause and production evidence

React #441 represents a Server Components render exception, not specifically a hydration mismatch (https://react.dev/errors/441). The installed Next.js React Server Components client uses this code for redacted server exceptions.

The deployed frontend still has the older server-rendered `Employer` implementation in `frontend/components/workspace.tsx`. The local EmployerPortal changes are not deployed. The production dashboard and jobs section perform:

1. `session`: authenticated response, HTTP 200.
2. `employers`: HTTP 200, nullable company profile.
3. `employer/jobs`: server-side fetch with a 15-second timeout.

The deployed backend authorizes `requireUser('employer')`, then calls `r.find('jobs', {employerId: u.id})`. Its PostgreSQL adapter executes `SELECT data FROM app_documents WHERE collection=$1`, transfers and parses every job in Node, and only then filters by employer and applies the limit. The same defect is present in the local adapter's shared read helper.

Read-only production inspection found 38,722 job documents with summed `pg_column_size(data)` of 140,754,065 bytes. This is stored size, not a measurement of the expanded JavaScript heap. Frontend logs at 05:31:07 and 05:32:03 UTC record TimeoutError with digest 3448439143 in the API helper and Employer server component. Backend logs show heap exhaustion while parsing JSON at 05:32:57 and again at 05:38:23; systemd automatically restarted it. No restart was initiated during this investigation. Other public job reads are also slow and remain a separate load risk.

Both navigation and reload execute the same server-rendered API read, explaining why both fail. There is no evidence that incorrect hooks, browser-only APIs, hydration, missing company data, or a denied employer session caused this particular error. A missing company profile is valid onboarding state. Production currently has one employer-role user and no company-profile documents.

## Local fix

- `backend/src/lib/postgres-read-filter.ts`: parameterized SQL prefilters for scalar equality and scalar `$in`. Field paths and values are query parameters. Unsupported predicates remain for the existing JavaScript matcher; they are not guessed or silently removed. Empty membership yields FALSE.
- `backend/src/lib/postgres-store.ts`: pass each read's existing query into the SQL prefilter before fetching rows for find/page/count/scan. Existing post-filtering, ordering, limits, ownership and RBAC remain in place.
- `backend/tests/postgres-read-filter.test.ts`: owner/association, empty membership, unsupported predicates, nested paths and SQL-injection regression checks.
- `backend/tests/postgres-employer-read-check.mjs`: read-only PostgreSQL contract and real-owner query verification. Synthetic fixtures exist only in a SELECT CTE, never in tables.

No frontend rendering workaround, timeout increase, fake employer data, auth bypass, database migration, or production configuration change was made. Existing unrelated uncommitted work was preserved.

## Validation

| Check | Result |
| --- | --- |
| Backend typecheck/build | PASS |
| Full backend regression | PASS: 203 tests, 0 failures |
| Targeted SQL filter + employer portal + HTTP workspace suites | PASS: 5 tests |
| Admin console regression including Student-to-Employer assignment | PASS: 1 integration test |
| PostgreSQL query contract | PASS: 4 read-only CTE checks |
| Actual employer job read with patched SQL | PASS: 0 owned jobs, 343 ms, count reconciled, owner isolation verified |
| Frontend lint/typecheck/production build | PASS, Next.js 16.3.7 |
| Live authorized Employer dashboard | FAIL as expected before deployment: reproduced #441 |
| Live company profile | PASS: correct unsubmitted onboarding form |
| Live Team | PASS: correct existing unavailable-invitation state |
| Live Post a job | PASS: existing form renders; nothing submitted |
| Live mobile Billing, 390 x 844 | PASS: rendered; document width 375, viewport 390, no horizontal overflow |
| Live Student direct Employer access | PASS: workspace restricted |
| Patched local browser UI | NOT VERIFIED: prior local frontend-start execution-policy rejection remains unresolved |
| Live Admin role mutation / relogin | NOT PERFORMED: production data was kept unchanged; isolated admin assignment and role revocation tests passed |
| Full patched live workflow | NOT VERIFIED: patch intentionally not deployed |

The read-only PostgreSQL check initially looked for a company profile and correctly reported none. It was then corrected to use the real employer-role user, covering the exact no-profile onboarding case that fails in production. It returned zero jobs in 343 ms without transferring unrelated jobs.

## Release assessment and remaining work

### Follow-up validation

- Added `backend/tests/employer-role-login.test.ts`. The isolated HTTP test passed actual password login, Student-to-Employer change through the existing Admin API, old-session revocation, re-login as the same Employer account, session refresh, company-profile onboarding, Admin API denial, logout, Employer-to-Student change and loss of Employer access. Candidate profile data and single-account identity were preserved. This uses a temporary MongoDB replica set, not production PostgreSQL, and is API verification rather than browser-routing verification.
- Checked and applied the narrow patch to a temporary local copy of the actual deployed adapter. The first check found Windows CRLF patch formatting prevented application. Normalized the patch artifact to LF and repeated the check successfully. The applied helper exactly matches the tested source; all four read methods pass their query to the SQL prefilter. No production file was changed.
- Browser validation of the patched frontend remains blocked by the previously reported command-execution policy restriction. The integration runner also starts Next.js, so it was not used as a workaround. Deployment and subsequent production workflows remain pending.

The targeted fix is locally validated, but full deployment approval is premature. The repository contains substantial unrelated migration/Employer/Application changes absent from production; do not deploy the entire working tree as this hotfix. `docs/employer-read-hotfix.patch` contains only the read fix and new helper, generated against the actual deployed source obtained read-only. It has not been applied remotely. Validate that exact artifact in an isolated frontend/backend environment, then obtain deployment authorization separately.

No production indexes were added. Owner filtering currently completes within the 15-second render budget without a new index. A future approved index/performance review should address broader unscoped job reads; this patch does not promise that every large or unsupported query is now bounded.

After an approved rollout, repeat employer dashboard/jobs/applicants, navigation, reload/direct URL and mobile tests, inspect server memory/error logs, and confirm the 15-second timeout and #441 are absent. Then proceed to controlled Apply/Gmail/TEST-payment workflows. Full Apply testing remains blocked pending that live verification. No email, payment, external application, commit, push, deploy, worker switch, or production-data mutation occurred.
