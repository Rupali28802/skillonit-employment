# Enterprise branch implementation update

This change extends the existing Next.js frontend and Express backend on `codex/enterprise-portal`. It preserves the prior interfaces and adds working candidate and operations features from the supplied scope. It is not a declaration that all 87 specification sections are production-complete.

## New working capabilities

- Saved searches with keyword/country/arrangement criteria, pause/resume/removal, matching links, explicit alert refresh and duplicate suppression.
- Persistent in-app notification center, read state, channel preferences, application/recruiter updates and match notifications. Unconnected outbound channels fail clearly.
- Candidate-authored, confirmed text CV versions with frozen profile facts, plan limits, download and owner-only removal. Binary upload and AI extraction remain disabled.
- Append-only template versions with subject/body/signature variable validation.
- Guided keyword search/support assistant returning only authorized job projections and describing its non-generative mode.
- Public contact and announcement editor, permission-evidence source registry, and auditable pause switches for the implemented assistant/alert features.
- Transactional daily application usage, personal/plan caps, and an indexed migration count that does not truncate at 1,000 records.
- Keyset retention traversal beyond 1,000 jobs with application history preserved.
- Public jobs/search routes, student/employer route aliases, FAQ/cookie/employer-pricing information and usable saved-query links.

## Security and correctness fixes

Authentication and ordinary writes use separate throttling counters. Invalid application action URLs cannot fall through to withdrawal. Expired or unpublished jobs are excluded from saved-job/matching results. Current configured identity entitlements are used in matching and application snapshots. Notification/CV/search records enforce ownership. Source inputs accept board identifiers rather than arbitrary fetch URLs. Feature switches cannot activate unavailable external integrations.

## Important operating limits

The local preview uses explicitly fictional test records. It sends no real applications, emails or payments. MongoDB has been exercised in an isolated test replica set, not the user's production cluster. Text CV download is not scanned PDF/DOCX upload. Search alerts are explicit checks and currently inspect one search-results page; a complete durable scheduled alert pipeline is still needed. Search and several older list APIs still have bounded fallbacks. The SSE endpoint remains a ready/heartbeat transport without production shared pub/sub.

The retained source specification and the full unresolved baseline are in `IMPLEMENTATION_STATUS.md`. OAuth, mail dispatch, CV scanning/extraction/private storage, paid activation, employer subscription/team coverage, production source ingestion, fine-grained admin roles, multilingual datasets, recovery and capacity targets must not be marked done based on this update.

## Verification

`backend/tests/features.mjs` adds positive/negative checks for ownership, immutable snapshots, CV limits, alert idempotency, quota concurrency, template variables/history, guided search gating, feature switches, source validation and admin access. `test:mongo` runs core and feature suites in an isolated MongoDB replica set and checks rollback/indexes plus retention of 1,050 expired jobs. `test:architecture` covers existing routes plus the added public/candidate pages and API proxy/session behavior. Browser QA and final build results are recorded in `TEST_REPORT.md`.

All local `.data`, environment files and dependency/build output remain ignored. No replacement repository is created and no unrelated source file is removed.
