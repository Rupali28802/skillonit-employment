# Job hunting engine

This implementation replaces the disconnected ingestion staging path with a standalone scheduled feed worker that stores normalized vacancies in the same MongoDB `jobs` collection used by the existing website. The old Greenhouse staging worker remains available for its previous tasks; use `worker:jobs` for the new engine. Authentication and Google OAuth configuration are unchanged. No SEO implementation was applied.

## Coverage

See [Worldwide platform inventory and country audit](GLOBAL_JOB_COVERAGE.md) for the expansion backlog and explicit missing integrations. Run `npm run jobs:coverage` for actual indexed country/occupation/type counts, including zero-inventory countries. Country filters support 250 country/territory entries (249 ISO entries plus Kosovo); this is not proof of inventory or website reachability in every country.

| Connector | Initial activation | Coverage and limits |
| --- | --- | --- |
| Arbeitnow | Available through `jobs:seed` | Multi-domain Europe-focused public job feed; paginated, four pages per run by default. |
| Arbeitnow UK | Available through `jobs:seed` | UK-focused public feed; four pages per run by default. |
| Remotive | Available through `jobs:seed` | Worldwide/restricted-location remote jobs across the categories the API supplies; public API data is delayed and may be limited. Six-hour minimum refresh. |
| Jobicy | Available through `jobs:seed` | Up to 200 latest remote listings, attributed original URLs; six-hour default refresh, at least hourly. Partial rolling inventory. |
| Adzuna | Configure only after provider approval | Country-specific connector, newest-first bounded pages; private ADZUNA_APP_ID and ADZUNA_APP_KEY required. No live account was provisioned. |
| USAJOBS | Configure only after provider approval | Federal announcements including overseas duty stations; private USAJOBS_API_KEY and registered USAJOBS_USER_AGENT email required. No live account was provisioned. |
| Ashby | Configure each approved employer board | Published/listed company jobs, supplied posting dates and location information. |
| Greenhouse | Configure each approved employer board | Public employer board jobs. Updated time is not substituted for the original posting date. |
| Lever | Configure each approved employer board | Public employer postings with bounded pagination. Original posting date may be unavailable. |
| LinkedIn, other social platforms, arbitrary websites | Not connected | Require an authorized retrieval feed/API and source-specific permission. A LinkedIn job-posting API posts jobs to LinkedIn; it is not an unrestricted worldwide search API. |

The engine accepts jobs across domains and countries; it does not promise every vacancy on the internet, real-time source updates, or complete global/country coverage. Unmapped occupations remain visible under Other. Categorization is deterministic, not an AI qualification assessment. Source location restrictions are preserved. A regional feed name alone is not treated as proof of an individual job's country.

Public API references checked on 10 September 2026:

- [Arbeitnow API](https://www.arbeitnow.com/blog/job-board-api)
- [Remotive API and syndication conditions](https://github.com/remotive-com/remote-jobs-api)
- [Ashby public postings](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [Lever postings](https://github.com/lever/postings-api)
- [LinkedIn posting API scope](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview)

Remotive requires an original listing backlink, source credit and public access without signup gating. These feed listings display their employer and source attribution publicly and link directly to the source. This does not remove the existing identity gate on native/private employer jobs. Remotive records must not be distributed to Google Jobs or other third-party job sites; existing noindex job metadata is retained and no JobPosting markup has been added. Review source terms before a commercial release; employer connectors require documented permission for each board.

## Run locally

Worldwide remote-source rollout: after building, run `npm run jobs:seed-worldwide`, then keep `npm run worker:jobs` running. This configures one daily Himalayas query per directory country/territory, a separate worldwide query, and Remote OK's daily feed. Existing configurations are preserved. India and UAE run first among the Himalayas sources. Each country fetches one newest-results page by default, explicitly excluding worldwide substitutes. Empty/unsupported responses remain visible in `jobs:coverage`; this is not complete local-market inventory. Total default Himalayas budget is up to 251 requests/day plus bounded failures, with a 1.5-second delay before requests and shared provider backoff after 429 responses. Do not increase page counts/cadence without reviewing provider limits.

Himalayas retains source credit separately from the original application URL and preserves timezone overlap requirements. The adapter accepts seconds (observed live) and milliseconds (documented) timestamps; listings past their stated close date are excluded. Its documentation says the public feed refreshes daily. Remote OK original backlinks are retained. These connectors add remote-job sources, not unrestricted LinkedIn/Indeed exports or proof of on-site inventory in every country. References: [Himalayas API](https://himalayas.app/docs/remote-jobs-api), [Remote OK feeds](https://remoteok.com/faq).

Use the existing backend `.env` privately, with the existing transaction-capable MongoDB connection. No additional API secret or Redis instance is required for these public feeds.

```sh
cd backend
npm ci
npm run build
npm run jobs:seed
npm run jobs:once
npm run jobs:status
npm run worker:jobs
```

`jobs:seed` creates missing public-feed policies only; it never re-enables or overwrites an existing source. `jobs:once` honors cooldowns; rerunning it is not a force-refresh. The continuous worker checks due sources every 30 seconds. Arbeitnow defaults to hourly; Remotive uses at least six hours. Keep the Express backend and Next.js frontend running in their own terminals using the existing project instructions.

For continuous service, deploy `npm run worker:jobs` as a supervised process with the same MongoDB configuration as Express. A laptop worker stops when its terminal/process/computer stops. Deployment, uptime monitoring and internet-wide coverage are not delivered merely by starting a local process.

## Configure an employer source

Copy `backend/config/job-source.example.json` outside tracked configuration if it includes private approval notes, then fill in the real employer board and evidence. Run:

```sh
npm run jobs:configure -- path/to/source.json
```

Supported types: `arbeitnow`, `arbeitnow-uk`, `remotive`, `jobicy`, `adzuna`, `usajobs`, `ashby`, `greenhouse`, `lever`. ATS types require board and company. Sources must be approved before enabling. `publish=false` stages listings for review. `publicListing=false` preserves the employer identity gate; public aggregator connectors require public source attribution. Do not approve or invent an employer relationship just because its board is publicly reachable.

Adzuna uses `countryCode`: au, at, be, br, ca, ch, de, es, fr, gb, in, it, mx, nl, nz, pl, sg, us, za. Confirm current country access with the provider account; UAE is not treated as supported. Create a separate configuration ID per approved country, use an agreed aggregate request budget, and optionally set `keywords` for source queries. Two pages per six-hour example means up to eight requests/day per configured country. Source-specific schedules do not establish an account-wide quota; choose them together before enabling many countries. No all-country fan-out is enabled automatically. USAJOBS likewise accepts optional `keywords` and preserves actual locations/eligibility/closing dates; US government ownership does not imply a US work location or global eligibility.

Examples are `backend/config/adzuna-india.example.json` and `backend/config/usajobs.example.json`. They are intentionally disabled/unapproved. Confirm caching/publication terms, set credentials privately, update evidence and approved/enabled/publish flags, then configure the source. Missing credentials produce safe error codes and zero network requests. Adzuna descriptions are excerpts; original links remain authoritative. Predicted salaries are not displayed as offered salaries.

To pause a source, configure its existing ID with `enabled=false`; the next worker cycle withdraws its active variants. Configuration updates do not reset cooldowns. Four pages is a per-source bound, configurable up to twenty. A partial result is explicitly recorded; bounded rolling feeds are not treated as complete inventories.

## Storage and safety behavior

- `jobFeedSources`: validated adapter policies, evidence, publication mode and schedule.
- `jobFeedStates`: attempts, successes, failures, counters and next permitted run.
- `jobFeedVariants`: source/external ID to canonical job mapping and missing-snapshot counters.
- `jobFeedFingerprints`: conservative cross-source duplicate matching.
- `jobFeedRuns`: per-run outcomes, retained for 30 days with a MongoDB TTL index.
- `jobEngineState`: renewable worker lease and shared feed revision.
- `jobs`: normalized records read by the existing search/detail APIs.

Network requests use fixed provider hosts, validated board IDs, timeouts, response-size caps and no automatic redirects. Pagination never follows source-supplied next URLs. Source data is rendered as plain text. Source URLs are HTTPS and validated. Errors are recorded as safe codes without connection strings or raw provider bodies.

The worker uses a MongoDB lease with ownership checks during writes. Repeated imports preserve first discovery/source dates and do not create duplicate records for the same listing. Exact canonical URLs deduplicate; cross-source records with matching title/company/location/description can share one job. Different same-board requisitions are not collapsed solely because their title matches. This conservative rule may leave rewritten cross-source duplicates for later review.

Known source dates older than 90 days, malformed/future dates and incomplete records are rejected. Missing original posting dates remain unknown. Listings not refreshed become unavailable after 72 hours or their 90-day source-date window, whichever is sooner. Complete employer snapshots require two misses before withdrawal. Failed, partial or invalid snapshots do not count as removals. Native application history is not deleted. Manual review/disabled/closed decisions survive refreshes; engine-closed inventory may reopen when the source returns.

Salary, experience and work mode are not fabricated. Missing values display as not specified; unknown experience does not match fresher filters. Public-source availability does not imply verified employers. Suspicious payment/credential requests go to review. The engine stores a source listing URL separately from an authorized application-form URL when the source API supplies both (for example, Lever `hostedUrl` and `applyUrl`, or USAJOBS `PositionURI` and `ApplyURI`). Apply opens the source-provided form only after an explicit candidate review and confirmation; the separate source link remains available for attribution. If a connector supplies only one authorized URL, that URL is used without guessing or scraping another destination. Opening an external form is recorded as started and never claimed as submitted. External forms receive no candidate profile, CV, or email from SkillOnIT; the candidate fills the source form. Email and native delivery use only candidate-confirmed data and require confirmation before they are queued. Discovery automation creates a `NEEDS_REVIEW` record and cannot open or send an application without a later candidate action.

Search queries now filter/page in MongoDB instead of truncating the first 1,000 jobs in memory. Keyword matching remains a database regex search, not a deployed full-text search cluster; production load/capacity testing is still needed. A shared poller observes feed revisions and notifies connected frontend sessions through the existing SSE endpoint. The user's current filters are retained; Pause live feed stops those updates.

Keywords include descriptions, original category labels and employment types, so professions outside the navigation categories remain discoverable. `type=part-time` matches source spellings such as `part_time` and `Part Time`. Explicit multi-country listings match each reported country; worldwide inventory is a separate filter and not silently treated as local inventory. Countries are normalized from ISO codes/names and common aliases (UAE, UK, USA); cities and broad regions such as EMEA remain geographically unresolved when no country is supplied. Existing records acquire improved metadata on their next normal source refresh.

## Operational inspection and verification

`npm run jobs:status` reports source state and counts. Existing authenticated administrators can also read `GET /api/v1/admin/job-engine`; anonymous users cannot read the source-policy dashboard.

```sh
npm run test:jobs
npm test
npm run build
cd ../frontend
npm run typecheck
npm run lint
npm run build
```

Tests use an isolated in-memory MongoDB replica set and synthetic source responses. They do not contact public providers or mutate the configured user database. Live sync results must be checked separately through `jobs:status` and the website. LinkedIn/social retrieval, additional approved company inventories, global taxonomy curation and large-scale search/worker deployment remain subsequent coverage work.
