# Local validation report

Validation performed on 5 September 2026 against the local Next.js application and fictional test records.

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

## UI and profile update — 7 September 2026

- Frontend production build and lint pass; backend build and all 12 unit tests pass, including private profile image validation and persistence.
- Architecture suite passes 43 page renders, session isolation, proxy cookies, SSE, CORS and request size checks.
- All 36 API integration assertions pass after restarting the local demo backend to clear the rate limit accumulated by consecutive test suites.
- Chrome checks confirm category filtering, fixed All opportunities button, moving category illustrations, static job grids, navbar profile photo linking to the student workspace, and desktop-only discovery sidebar. Tablet (1024px) and mobile (390px) have no horizontal document overflow.
- Repository secret-pattern scan passes; private environment files and demo data remain ignored. This update does not validate live mail providers, payments or a production MongoDB connection.
