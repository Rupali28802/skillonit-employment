# Local validation report

## Latest enterprise feature validation on 5 September 2026

- Frontend optimized production build passed on Next.js 16.3.4, including TypeScript and page generation. Frontend lint/typecheck passed.
- Backend TypeScript/build and all 11 domain tests passed.
- The 36-assertion core API suite passed on the dedicated local backend.
- New feature API suite passed with two isolated candidate identities: ownership denials, CV confirmation/limits/frozen facts, template signature validation/history, saved-search alert idempotency, notification access, guided-search projections, quota concurrency and admin policy controls.
- The real MongoDB replica-set suite passed the core and new feature suites, transaction rollback and index checks. The extended retention test processed 1,050 expired jobs, found zero work on a second pass and retained application records.
- Chrome showed the running homepage and candidate dashboard. Chrome tab reconnection became unreliable; the in-app browser verified saved-search form submission, the new match notification and candidate navigation. At 390×844, the document width was 375px, with no horizontal document overflow on the saved-search screen.
- No real email, job application or payment was sent. Browser/test records use the explicitly labeled local demo.
- The source secret-pattern scan passed. Private environment, local data, dependencies and build output are excluded from Git.
- The expanded 51-route architecture/transport suite is wired into CI but has not yet been rerun against the final production frontend: automated approval review blocked restarting the preview after the successful build, including a localhost-only attempt. The review supplied only “blocked by policy.” Preview restart approval is pending. Earlier route-test results below are historical, not a result for the new routes.

This update validates the listed work only. `IMPLEMENTATION_STATUS.md` and `ENTERPRISE_UPDATE.md` describe remaining implementation and provider gaps. No production deployment, million-user scale test or full-spec completion is claimed.

The first sections record validation of the original hybrid implementation on 5 September 2026. The architecture separation verification at the end records the current frontend/backend project.

| Check | Result |
|---|---|
| Strict TypeScript | Passed |
| Application lint | Passed; unchanged vendored UI primitives are excluded from the project lint gate |
| Domain tests | 11 passed |
| API integration suite | Passed: search, RBAC, input validation, origin checks, unavailable providers, organization review, job publication, idempotent application, applicant status, withdrawal, closure, leads and audit |
| Production build | Passed on Next.js 16.3.4; final build has no reported tracing warning |
| npm dependency audit | Zero reported vulnerabilities after compatible dependency fixes |
| Source secret-pattern scan | Passed; no `.env.local`, `.data`, credentials or build output selected for source delivery |
| Chrome | Initial homepage loaded successfully; Chrome later disconnected, preventing full Chrome-specific QA |
| In-app browser desktop | 1440px viewport checked; document width 1425px, no horizontal page overflow; arrangement filter returns two remote sample vacancies |
| In-app browser mobile | 390px viewport checked; document width 375px, no horizontal page overflow; complete mobile filters displayed |
| Browser interactions | Remote search, candidate demo sign-in, profile save and sample application review/confirmation passed |
| Hydration | Currency formatting mismatch found and fixed by specifying fraction-digit behavior; refreshed page showed no issue overlay |
| Build privacy | Standalone root contains runtime output only; demo data and local environment excluded from tracing |

The integration suite leaves clearly named fictional test records in ignored local storage. A demo application sent through the UI explicitly reports that no real employer was contacted.

## Not validated

Real MongoDB transaction/concurrency behavior, provider OAuth, CV scanning/parsing/storage, mail delivery, paid plan activation, live source ingestion, real-time pub/sub, all admin subroles/MFA, complete automated accessibility coverage, production deployment, GitHub-hosted CI execution, high-load/soak/spike/failover behavior, backup/restore or the million-user milestones. These remain release requirements, not implied passes.

See `IMPLEMENTATION_STATUS.md` for the full requirement-by-requirement gap list.
# Architecture separation verification — 2026-09-05

- Next.js frontend and Express backend compile independently. Frontend production build verified with backend stopped; Express starts without a frontend process.
- All 11 existing domain tests pass after migration to the backend.
- Existing 36-assertion API suite passes directly against Express and through the Next.js `/api` proxy.
- Real isolated MongoDB replica-set test passes the API suite, confirms persisted contact/application records, unique/TTL index bootstrap and transaction rollback. No production database or external account was used.
- Architecture transport suite passes: all 43 existing page routes render, concurrent role sessions remain isolated, cookies are forwarded, direct and proxied SSE emit readiness events, CORS rejects untrusted origins, and oversized bodies return 413.
- Chrome desktop baseline comparison: homepage DOM is unchanged except removal of the development-only Next.js toolbar when running production. Homepage visuals match the original. Remote search returns the same two jobs; sign-in reaches the candidate workspace; saving the unchanged profile confirms success.
- Chrome mobile at 390×844: discovery layout and filter controls work without horizontal document overflow. Browser error/warning log is empty after interaction checks; viewport restored afterward.
- Source preservation check: 72 UI/asset files unchanged; five data-fetching files retain JSX tags, visible text, static attributes and inline styles. All original CSS, animation definitions and client interaction components are unchanged.
- Frontend lint and TypeScript checks pass. Both dependency trees report zero audit vulnerabilities. Repository secret scan excludes private env/data/build files.
- Existing unconfigured mail, CV, automation and payment activation responses remain as before. This report validates separation, not completion of the original enterprise backlog.

The earlier sections document the original implementation milestone before architecture separation.
