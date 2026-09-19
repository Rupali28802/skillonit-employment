# Implementation work and access holds

Updated 11 September 2026. This supersedes earlier statements that USAJOBS still awaits terms approval. USAJOBS is connected. No new provider applications were submitted in this pass.

## Delivered in this pass

- Search API supports city, explicit skill intersections, trust, source, public company and curated MNC filters.
- Salary-range filtering requires matching currency and salary period; undisclosed salaries are excluded. Ranges overlap the requested interval. Invalid or unitless salary requests return no results rather than mixing incompatible pay.
- Jobicy and Himalayas structured salary fields now reach normalized records on refresh.
- Coverage audits count normalized records and available skills, experience, salary, structured city/state, posted/update/expiry dates and verified status.
- Admin engine status includes the latest persisted coverage report and provider backoff records behind existing admin authorization.
- Existing UI is unchanged; new optional API filters do not add visible controls. Existing query parameters continue to work.

## Access-dependent holds

| Item | Hold reason |
|---|---|
| LinkedIn / Indeed | Await provider-approved retrieval/display access |
| 27 Jooble requests | Unconfirmed issuance; do not duplicate requests |
| Adzuna / Reed / France Travail / NAV | Credentials/onboarding and provider terms/access |
| ReliefWeb | Real organization-domain email and approved appname |
| Careerjet | Publisher credential and deployment visitor/proxy configuration |
| SmartRecruiters employer rollout | Specific employer source/display scope not confirmed |
| Social channels | Authorized provider and channel access; no blanket social-post access |
| Production release | Hosting/domain and production service configuration missing |

## Engineering still pending (not attributed solely to missing access)

Semantic retrieval and evaluated AI extraction; full provider field mappings and existing-record backfill; advanced multilingual/related-role taxonomy; stronger evidence-based fraud/employer verification; deeper repost/duplicate evaluation; social ingestion/moderation code; broad regional research; complete user-facing filter controls; continuous alert delivery and live-stream end-to-end evaluation; production scale and recovery validation. The definition-of-done document tracks these. This pass does not claim that all access-independent engineering has been completed.

## Search API examples

`/api/v1/jobs?city=London&skills=Patient%20care&trust=verified`

`/api/v1/jobs?salaryMin=30000&salaryMax=60000&currency=GBP&salaryPeriod=annual`

`/api/v1/jobs?source=USAJOBS`

A zero count can be correct: unknown facts are not guessed, and an imported source does not imply verified employer status.

## Validation

Backend build passed, 35 focused engine tests passed, and all 72 backend tests passed. API and worker restarted on the new build. Latest audit contains 7,454 live records; only 753 have the new normalizedFacts object, so historical normalization remains partial. No independently verified listings were counted. No UI files changed.
