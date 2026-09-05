# Implementation status and remaining work

This file distinguishes executable local behavior, implementation scaffolding, unavailable integrations and incomplete requirements. It is not a production completion certificate.

## Enterprise branch update on 5 September 2026

The latest changes add saved-search create/pause/remove and explicit match checks; deduplicated in-app alerts; notification preferences/read status; confirmed profile-based CV versions and text download; immutable template history; a clearly labeled keyword search/support assistant; admin source permission records, public contact/announcement editing and supported feature switches. Application and recruiter status changes generate in-app notifications. The current UI keeps frontend/backend separation and adds the new workflows to the candidate navigation.

Quota reservation now uses a transactional daily ledger with an indexed, unbounded-count bootstrap for existing records. Personal caps and plan caps are enforced. MongoDB integration exercises simultaneous applications competing for the last slot. Retention uses keyset traversal rather than stopping at 1,000 jobs; the MongoDB test expires 1,050 synthetic jobs, verifies idempotency and preserves application records. Expired jobs no longer appear in matches/saved inventory. Unsupported application action URLs return 404. Template signature variables are validated too. Authentication throttles no longer share the normal-write counter.

These changes do **not** complete the entire enterprise contract. Scanned PDF/DOCX upload, extraction, production verification email/recovery, OAuth, application email dispatch, production ingestion/pub-sub, paid entitlement activation/reconciliation, complete employer teams/subscriptions, granular admin roles and high-scale infrastructure still need implementation and/or configured services. The guided assistant is not generative AI; alerts are checked explicitly, not a configured recurring notification worker.

The original requirement table below records the earlier baseline; the update above supersedes its statements about quota tracking, retention batching, MongoDB testing, template history, manual CV versions, saved searches, in-app notifications, source policy entry, content/flags and the guided assistant. All other listed gaps remain open.

## Working local workflows

Discovery and filters; sample job details; identity masking; role-specific sign-in; local test registration and email verification; candidate-confirmed profiles; preferences; deterministic match explanations; saved jobs; templates; direct demo applications and state history; duplicate suppression; recruiter status changes; withdrawal; employer organization review; review-to-publish moderation; closure; contact lead storage; fraud reports; admin records and plan editor; audit events; private export and deletion request capture.

The automated API suite exercises organization verification, publishing, application submission, deduplication, recruiter status, withdrawal, closure, lead capture, audit, invalid input, missing authentication, wrong role, cross-origin rejection and unavailable services.

## Requirement traceability

| Requirement | Status and limitations |
|---|---|
| R-001 worldwide platform | Country/currency-aware records and formatting; starter country inventory, not a complete world location database. |
| R-002 device support | Responsive CSS and accessible form labels; desktop and 390px mobile layout, filtering and profile-save checks passed in the in-app browser; final Chrome-specific QA remains outstanding after Chrome disconnected. |
| R-003 search-centered home | Implemented. |
| R-004 continuous live feed | SSE connection/heartbeat and pause/resume transport exist. Shared pub/sub and real ingestion notifications are not implemented. |
| R-005 90-day inventory | Domain filter and bounded retention worker exist. Production batch traversal is required beyond 1,000 jobs. |
| R-006 all job domains | Extensible category seed, not complete international occupation taxonomy. |
| R-007 related roles | Preferences and deterministic matching implemented; no semantic model. |
| R-008 experience | Numeric ranges and fresher intent implemented. |
| R-009 India/global | Country/city model and all 36 India states/UTs in filter seed; worldwide dataset import outstanding. |
| R-010 top/MNC | Model field exists; curation and filter UI incomplete. |
| R-011 email application | Disabled. OAuth, token encryption, attachment delivery, destination verification and sender workers are not configured/complete. |
| R-012 ATS application | Domain/API track EXTERNAL_STARTED separately from confirmed submission; external adapter and UI fixture testing outstanding. |
| R-013 hidden identity | Public serializer removes company/contact fields and scrubs common narrative identity/contact strings; arbitrary source content requires further structured-field controls before production. |
| R-014 apply gate | Authentication, verified profile, trust, freshness and daily cap enforced; broader entitlement catalogue incomplete. |
| R-015 plans | Basic/Pro/Premium definitions and admin editor exist; final prices intentionally unset. |
| R-016 timing | Delay configuration and scheduled timestamp exist; no email scheduler/sender implementation. |
| R-017 counts | Transactional duplicate/quota checks implemented with bounded history queries; production usage ledger and concurrency validation outstanding. |
| R-018 profile/CV | Manual profile works; file upload disabled pending private storage/scanning. |
| R-019 CV extraction | Provider interface only; parser, scanner, confirmation review and version storage incomplete. |
| R-020 templates | Subject/body/signature editing and allowed-variable validation exist; version history and CV bindings incomplete. |
| R-021 history | Persistent state transitions and application snapshot exist. |
| R-022 employer portal | Organization review, posting, applicants and closure work; team invitation and richer analytics incomplete. |
| R-023 employer subscriptions | Pending final commercial model, entitlement implementation and billing integration. |
| R-024 compliant discovery | Approved-source-only Greenhouse adapter and staging worker scaffold; no real source approved, no continuous production ingestion. |
| R-025 verification | Manual admin review gate works; domain-evidence collection and automated verification incomplete. |
| R-026 fraud controls | Baseline risk classifier and report/moderation flow exist; real destination verification not implemented. |
| R-027 admin | Core lists/moderation/plans/audit implemented; fine-grained admin roles, MFA, full queues/content/flags controls and advanced operations incomplete. |
| R-028 leads | Contact capture and review statuses implemented; assignment/notes UI beyond review note incomplete. |
| R-029 contacts | User-provided business email displayed; no phone supplied and none invented. Admin contact configuration incomplete. |
| R-030 WhatsApp | Not configured or implemented beyond provider-readiness disclosure. |
| R-031 mail | Interface and fail-closed controls only; no authorized mailbox session/provider. |
| R-032 chatbot | Not implemented. |
| R-033 Razorpay | Order and webhook-signature/idempotency primitives exist; checkout UI, paid entitlement activation, reconciliation/refunds and sandbox tests incomplete. Do not enable production billing. |
| R-034 MongoDB | Repository, transactions and indexes implemented; not tested against a configured real cluster. |
| R-035 Next.js | Next.js App Router, TypeScript, SSR, standalone production build implemented. |
| R-036 SEO/AEO | Metadata, crawl exclusions and static-page sitemap exist. Sample/gated jobs are noindex; truthful public JobPosting data is not yet enabled. |
| R-037 editable settings | Candidate plan editor implemented; feature-flag/source/content administration remains incomplete. |
| R-038 millions of users | Architecture direction and load-test plan documented; load milestones untested and current bounded fallback queries are not scale-ready. |
| R-039 spikes | Not validated; production CDN/cache/WAF/autoscaling/pubsub and queue isolation require infrastructure and testing. |

## External dependencies and access blockers

1. Git access was restored through the authorized Git client. The existing main branch contained only its original README and is preserved as the branch ancestor. The GitHub connector still returned 404; Chrome later disconnected from browser tooling. No alternate repository was created.
2. No production MongoDB/Redis, hosting, object storage/scanning, OAuth mail app, notification service, Razorpay or WhatsApp configuration was provided through secure environment variables.
3. Final commercial prices, employer allowances, approved source inventory, business phone and production domain remain unspecified.

These are not all configuration-only tasks: the incomplete capabilities above require further implementation as well as access. A passing local build must not be described as the complete enterprise project.
