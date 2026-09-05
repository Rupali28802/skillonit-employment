# Frontend/backend separation

## Scope

Architecture-only migration of the existing project from `portal/`. No redesign or feature replacement. Original specification documents and unrelated repository work are retained. The original implementation commit is `94b28f81f389a9e7f596ff35875b46f24e0abebd`.

| Previous location | New owner |
| --- | --- |
| `portal/app/api/v1/[...path]/route.ts` | `backend/src/api.ts`, mounted by Express |
| `portal/app/api/v1/jobs/stream/route.ts` | Express SSE route in `backend/src/app.ts` |
| `portal/lib/security.ts` | Backend authentication plus request-local Express cookie transport |
| `portal/lib/store.ts` | Backend MongoDB, transactions, indexes and demo persistence |
| `portal/lib/search.ts`, schemas, providers, pipeline, fixtures | Backend only |
| Domain matching, eligibility, plan defaults, redaction, state transitions | Backend only |
| `portal/workers/` | `backend/src/workers/`, separately executable |
| Page/component database reads | Typed API presentation fetches in `frontend/lib/api.ts` |
| Existing UI components, styles, assets, pages | `frontend/`, preserved |
| Domain/API types and UI filter constants | `frontend/lib/domain.ts`, no server implementation |
| Local private configuration/data | Backend `.env` and `.data`; never committed |

Existing API response envelopes, routes, authorization checks, validation and workflow transitions are retained. Additional read-only `/session` and `/me/dashboard` endpoints support the existing UI without frontend access to databases. Public job detail includes the backend-computed application availability flag. Session transport uses AsyncLocalStorage to isolate concurrent Express requests. The proxy forwards cookies and Set-Cookie headers; browser code retains its existing `/api/v1` calls.

The frontend's Next.js server components perform presentation rendering and API fetches only. They contain no API route handlers, database reads, provider calls, password handling or business-rule execution. This preserves initial page rendering and avoids introducing client-side loading changes.

## Verification

See the architecture verification section in `TEST_REPORT.md` for final executed checks. The real MongoDB test uses a temporary local replica set, not a production account. Live external mail/payment credentials are not needed or introduced for this refactor.
