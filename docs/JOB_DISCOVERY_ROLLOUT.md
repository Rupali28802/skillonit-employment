# Job discovery and normalized-data rollout - 11 September 2026

## Scope and measured status

The existing 174-source inventory remains the master research list: [source inventory](JOB_SOURCE_MASTER_AUDIT.html), [regional research](WORLDWIDE_JOB_ENGINE_RESEARCH.md). It is an expanding inventory, not every website in the world. Its older USAJOBS and SmartRecruiters status is superseded here: USAJOBS is live (initial 400-record bounded import); SmartRecruiters is built but no approved employer board is configured. There are 12 previously live feed types including USAJOBS, not 12 complete platform networks. LinkedIn/Indeed and 27 unconfirmed Jooble requests remain pending. No duplicate applications were submitted.

## Data contract implemented

Existing UI fields remain compatible. Newly imported/refreshed records include normalizedFacts with explicitly nullable facts. Unknown values are not invented by AI.

| Requested field | Storage / behavior |
|---|---|
| Job title, company, description | title, company, description; existing HTML sanitization retained |
| Skills | skills contains explicit source skill fields; occupation labels and tags kept separately and searchable |
| Experience | normalizedFacts.experience min/max/text; null when unknown, existing disclosure flag retained |
| Salary | normalizedFacts.salary min/max/currency/period/text; invalid ranges remain unknown |
| Country | country plus eligibleCountries; remote eligibility is not proof of local employment |
| State, city | structured values when supplied; normalizedFacts.locationText retains the original location string |
| Remote / Hybrid / On-site | mode; not inferred from absence of office information |
| Employment type | type retains original unmatched source types |
| Posted, updated, expiry | normalizedFacts dates are source facts or null; sourceUpdatedAt is separate from first posting |
| Freshness | normalizedAt and feed.lastSeenAt; expiresAt remains the platform availability deadline |
| Apply URL | publicApplicationLink for public authorized sources, with existing attribution rules |
| Source, source job ID | source and public sourceJobId |
| Trust | verified / pending / flagged; source authorization does not independently verify a vacancy |

USAJOBS structured salary and single-location city/state are now mapped. Jooble and Greenhouse update timestamps are preserved without presenting them as new posting dates. Ashby and SmartRecruiters structured locations are mapped. SmartRecruiters listing queries explicitly request PUBLIC postings. Missing social-post facts must remain in review; no social ingestion or generative AI verification is claimed.

Existing records gain these fields on their next successful scheduled refresh. This is not a completed historical backfill. Workers retain provider-specific intervals, cooldowns and budgets, so this does not promise immediate detection or full inventory.

## Official routes rechecked

| Provider | Official evidence | Next prerequisite |
|---|---|---|
| USAJOBS | https://developer.usajobs.gov/api-reference/get-api-search | Live credential; broaden bounded pagination strategy and measure coverage |
| Adzuna | https://developer.adzuna.com/docs/terms_of_service | Issued access; respect minute/day/week/month quotas and display terms |
| Reed | https://www.reed.co.uk/developers/jobseeker | Existing request response / key, no duplicate request |
| SmartRecruiters | https://developers.smartrecruiters.com/reference/v1listpostings | Employer-specific permitted scope; public and internal destinations are different |
| Careerjet | https://www.careerjet.com/partners/api | Publisher account key, visitor-triggered search integration; not scheduled bulk harvesting |
| France Travail | https://www.data.gouv.fr/dataservices/api-offres-demploi | Onboarding and reuse licence; only partner-consented offers are distributed |

Other regional routes remain individually unverified as marked in the master inventory. ReliefWeb needs the organization's actual domain email; NAV needs provider access. Hosting/domain and production dependencies remain unresolved. These cannot truthfully be marked complete based on code changes.

## Validation

Backend build and all 33 job-engine tests passed. Homepage returned HTTP 200. Worker restarted. Latest country/sector audit: 7,446 live records, 4,414 with unknown geography, 12 source types with successful imports. These figures are partial coverage, not worldwide completeness. Secret scan passed; private environment files remain excluded.

