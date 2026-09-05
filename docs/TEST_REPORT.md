# Local validation report

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
