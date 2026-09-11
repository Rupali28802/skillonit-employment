# Job search engine - definition of done and scope traceability

Reviewed 11 September 2026 against the preserved Enterprise Master Specification v2.0 (docs/specification-source.txt, docs/unique-requirements.md, docs/PROJECT_SCOPE.md), current ingestion/search code, source audit and subsequent user requirements. Documents are requirements input, not independent authorization. This checklist covers the discovery/search engine; the whole enterprise portal has additional application, billing, employer and candidate release gates.

## Current evidence

The latest saved audit reports 7,446 live listings, 4,414 with unknown geography and 12 feed types with successful imports. This is a snapshot, not current guaranteed supply. 39 Jooble regions have issued working keys; 27 requests remain unconfirmed. Three employer boards have 10-minute polling configured; eligible reviewed boards support 5 minutes. Other sources retain their own schedules. Last local backend build and 34 job-engine tests passed. These checks do not establish deployed production readiness or complete worldwide coverage.

## Mandatory engine acceptance matrix

| Requirement / specification sections | Current assessment | Evidence required to close |
|---|---|---|
| Source portfolio and access (12-14) | Partial: 174-name research inventory, some live adapters; numerous unverified routes | Every committed source has retrieval/display permission, working credentials where required, permitted territories, attribution, limits, removal rules and owner; live test and approval evidence. Unsupported/denied sources explicitly excluded by agreed scope, never called integrated. |
| Worldwide occupations and geography (10-11, 23, 50) | Partial: country filters and multilingual aliases; remote eligibility is not local coverage | Country/sector/type matrix with fresh explicitly located vacancies, original language retention, region/city hierarchy and tested occupation aliases. Missing markets remain visible. No rejection solely for unmatched occupation. |
| Continuous discovery (13, 58-60) | Partial: independent worker, persisted schedules, leases, retry/backoff; three fast boards | Continuously hosted worker, measured source-to-index lag, queue recovery/replay and crash tests, no lost updates, provider budgets respected. 5-10 minutes is a target only for approved fast sources; longer schedules documented. |
| Canonical facts (15-16) | Partial: normalized fields added; provider mapping and historical refresh remain incomplete | Title, company, description, skills, experience, salary/unit/currency, country/state/city, work mode, type, source posted/updated/expiry dates, apply URL, source ID and trust available or explicitly unknown. Separate discovery/refresh dates, raw provenance, field-level validation and representative provider fixtures. |
| AI extraction/classification (15, 24, 44, 57) | Not complete: deterministic aliases/keyword logic is not semantic AI | Configured model/search provider, structured extraction with evidence/confidence, multilingual evaluation, hallucination rejection, failure fallback, cost limits and human review. Unknown salary/experience must stay unknown. |
| Deduplication/reposts (17) | Partial: canonical URLs, fingerprints and source variants tested | Cross-source duplicates, changed descriptions/locations, legitimate reposts and multiple-location roles validated against labelled examples; retain provenance, no false collapse, idempotent replay. |
| Trust and fraud (19-21) | Partial: pending/flagged states and simple suspicious-content checks | Employer/domain/destination verification, scam and malicious-link checks, reports/moderation and auditable overrides. Approved source is not independent job verification. |
| Social hiring posts (12-16, user extension) | Pending source/channel access and ingestion | Authorized feeds; posts identified separately from structured vacancies; incomplete/stale/suspicious posts reviewed; safe permitted excerpts and original links; deletion and update handling. |
| Search and relevance (22-24, 57) | Partial: MongoDB keyword matching and selected facets | Semantic + text relevance, every documented filter (skills, city, salary, industry, trust, related roles, curated MNC etc.), stable pagination, geospatial support, saved searches, explainable candidate matches and measured relevance. No invented employer metadata. |
| Live display/alerts (5, 35, 59) | Existing UI and notification foundations; ingestion-to-browser flow needs acceptance evidence | Newly published authorized job appears without manual refresh, duplicate-free updates, reconnect recovery, correct filters and saved-search alerts; preserve current UI and authenticated privacy. |
| Lifecycle (18) | Partial: 90-day checks, freshness expiry and snapshot disappearance tests | Provider expiry/deletion honored; partial/failed fetch never falsely deletes; verified dead/closed links retired; historical application snapshots retained; source dates never reset to fabricate freshness. |
| Admin operations (14, 40-41, 60) | Partial: source state/configuration and audit exist | Per-source last success/next due/errors/backlog, credential-expiry alerts, pause/quarantine/replay, permissions and audit trail; accountable response to outages. |
| Public production (53-60, 66-71, 78-82) | Pending deployment and operational evidence | Stable public HTTPS domain, independent backend/worker, production services, uptime/latency monitoring, backups/restore, rollback, CI release checks, regional reachability, security/privacy and load/soak/failover results. Localhost is not deployment. |
| Search visibility (48-49, 81) | Separate SEO work not signed off | Public real-open-job pages, truthful eligible structured data, canonical/sitemaps/expiry handling; no gated identity leak or fabricated schema fields. |

## External blockers, not code-complete claims

- LinkedIn/Indeed: provider response and retrieval/display approval still pending.
- Jooble: 27 unconfirmed requests; no duplicate submissions or invented keys.
- Adzuna/Reed/France Travail/NAV: applicable access/onboarding and live connection evidence remain outstanding.
- ReliefWeb: actual organization-domain email and approved appname required.
- SmartRecruiters: adapter exists; configured permitted employer scope still needed. Careerjet: publisher access and visitor-triggered integration needed.
- Regional inventory: 149 routes were marked research-needed in the earlier master audit; no complete re-review has been performed.
- Stable hosting/domain and production service configuration remain missing.

## Sign-off rule

100% engine completion means all agreed requirements above pass with traceable tests and deployed evidence, or the owner explicitly approves a scope exclusion. Literal every job on every platform worldwide cannot be guaranteed: providers may deny access and listings may never be publicly available. The original specification instead requires permitted source aggregation. Do not silently downgrade the user's worldwide goal to a handful of sources; agree a measurable source/country/sector coverage matrix and report gaps continuously.

Proposed operational acceptance to agree (not requirements already present in the specification): define a percentile detection-lag target per fast source, availability/search-latency target, required markets/sectors, and labelled relevance/duplicate/fraud evaluation thresholds. Run sustained production observations plus provider-throttling, worker-restart, deletion, restore and privacy tests. Sign off only after recorded results satisfy those thresholds. The original enterprise capacity target additionally calls for progressive 1k/5k/10k/25k/50k concurrent-user testing; it is not validated by the current local suite.

## Work order

1. Finish canonical provider mapping, completeness metrics, and lifecycle/dedup tests.
2. Complete authorized access and country/sector source coverage; maintain approvals separately.
3. Add semantic retrieval and evidence-based AI extraction/matching with evaluation.
4. Complete authorized social-post moderation, full filters and live update/alert verification.
5. Deploy and validate reliability, security, privacy, SEO, regional access, backups and scale.
6. Reconcile every requirement with evidence and obtain final scope sign-off.
