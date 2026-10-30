# Worldwide job-search engine: research and implementation report

Research date: 11 September 2026. This report complements the searchable `JOB_SOURCE_MASTER_AUDIT.html` and the full CSV/JSON inventory. It distinguishes actual working connections from possible sources. The inventory contains 174 named platforms/source classes, not a census of every employer website. A comprehensive worldwide service requires an expanding employer registry and licensed feeds; no single API supplies every vacancy or every hiring post.

## What is working

The previous verified snapshot contained 10 connected feed types, 298 configured feeds and 6,573 unexpired published listings. Arbeitnow UK is counted separately from Arbeitnow; the count is not unique corporate brands. Jooble has 39 regional connections, while Himalayas supplies country eligibility queries. Three employer boards are connected through Ashby, Greenhouse and Lever. Each ATS connection covers only its configured employer, not its entire network.

This implementation adds JobSearch from Sweden's public employment service and a credential-gated Reed search connector. The refreshed master inventory records the live JobSearch result. Reed is not counted as connected without a working key. UI and authentication are unchanged.

## Source families and integration decisions

| Family | Platforms | Access and implementation decision |
|---|---|---|
| Broad international aggregators | Jooble, Adzuna, Careerjet, Talent.com, Jobrapido, JobisJob | Use licensed retrieval APIs. Jooble is live in 39 regions; Adzuna code exists but keys/access are missing. Careerjet requires a real visitor-triggered search, so it is not a background crawl adapter. Other routes require individual verification. |
| Large marketplaces | LinkedIn, Indeed, Glassdoor, ZipRecruiter, Monster, SEEK | Obtain explicit job retrieval/display rights. A posting, apply, sign-in or recruiter API does not establish general search/export access. LinkedIn and Indeed enquiries remain pending. |
| Public employment services | USAJOBS, NCS, France Travail, NAV, Arbetsförmedlingen, EURES, Canada Job Bank, national/state portals | JobSearch is directly usable; USAJOBS requires a key; France Travail/NAV require onboarding. Review each other service separately. Government ownership does not itself establish an open feed. |
| Direct employer systems | Ashby, Greenhouse, Lever, SmartRecruiters, Workday, Oracle, SAP, iCIMS, Workable, BambooHR, Teamtailor, Recruitee, Personio, Pinpoint, Zoho | Maintain employer-by-employer identifiers and evidence. Expand public/authorized career feeds. SmartRecruiters company postings and its partner delivery feed are different interfaces. |
| Remote work | Remotive, Jobicy, Himalayas, Remote OK, We Work Remotely, Working Nomads, Remote.co, FlexJobs | First four are connected. Confirm permitted feeds for the remainder. Remote does not mean every-country eligibility. |
| Specialist and public-interest | ReliefWeb, UN Careers, Impactpool, Idealist, EURAXESS, Nature Careers, Science Careers, Hcareers, Rigzone, Energy Jobline, Aviation Job Search | Add sector-specific feeds to reduce technology bias. ReliefWeb now requires an approved appname; other access is pending verification. |
| Freelance/gig | Upwork, Freelancer, Fiverr, PeoplePerHour, Toptal | Assess approved project-search access independently. Seller services and tasks must not be represented as employment vacancies. |
| Employer hiring posts | LinkedIn posts, Facebook pages/groups, X, Reddit, Telegram, Discord, WhatsApp, Slack, newsletters | Obtain provider and channel-specific access. Extract role/company/location/application URL with original attribution; retain a moderation queue when facts are incomplete. No universal social hiring-feed API is established. |

## Regional acquisition checklist

These are priority discovery candidates, not claims of current API availability. The master CSV has an individual status for the named candidates.

| Market | Priority sources in addition to aggregators and employers |
|---|---|
| India | NCS, Naukri, Foundit, Shine, TimesJobs, Apna, WorkIndia, Internshala, Cutshort, Hirist, iimjobs, Freshersworld, Unstop, UPSC/SSC/state recruitment |
| UAE/GCC/MENA | Bayt, GulfTalent, Naukrigulf, Dubizzle, Dubai Careers, FAHR, MOHRE, Qatar Living, Jadarat, Akhtaboot, Wuzzuf, Forasna, Tanqeeb |
| UK/Ireland | Reed, Totaljobs, CV-Library, DWP Find a job, NHS Jobs, Civil Service Jobs, jobs.ac.uk, IrishJobs, Jobs.ie |
| US/Canada | USAJOBS, ZipRecruiter, Dice, Built In, Handshake, HigherEdJobs, GovernmentJobs, Canada Job Bank, Eluta, provincial/state/local portals |
| Australia/New Zealand | SEEK, Jora, Workforce Australia, APS Jobs, EthicalJobs, Trade Me Jobs, jobs.govt.nz |
| Continental Europe | EURES, France Travail, APEC, Bundesagentur für Arbeit, StepStone, XING, InfoJobs, Infoempleo, Pracuj, Jobs.cz, Profession.hu, NAV, Arbetsförmedlingen |
| East/Southeast Asia | JobStreet, JobsDB, MyCareersFuture, Glints, Kalibrr, VietnamWorks, TopCV, 104, 1111, Wantedly, Daijob, GaijinPot, Rikunabi, Mynavi, JobKorea, Saramin, BOSS Zhipin, Zhaopin, 51job |
| South/Central Asia | Bdjobs, Rozee, Mustakbil, topjobs.lk, Merojob, JobsNepal and national employment services |
| Africa | Jobberman, BrighterMonday, MyJobMag, Fuzu, PNet, Careers24, CareerJunction and national services |
| Latin America/Caribbean | Computrabajo, Bumeran, ZonaJobs, OCC, Get on Board, Catho, InfoJobs Brazil, elempleo, Konzerta, CaribbeanJobs |
| Small markets/islands | National employment ministry, local general board, major employers, universities and authorized recruitment agencies; absence of a listed brand is an explicit research gap |

For every country/territory, track locally located jobs separately from remote eligibility, unknown geography, and worldwide roles. Track the date of last successful fetch and observed sector/job-type distribution. A country dropdown is not proof of local coverage. The existing `npm run jobs:coverage` produces the measured country inventory.

## Current official access findings

- [JobSearch](https://data.arbetsformedlingen.se/dataservice/jobsearch/) is public, CC0 and needs no registration. [API schema](https://jobsearch.api.jobtechdev.se/swagger.json) documents bounded offset/limit and newest-first ordering. Implemented four pages per six-hour run; this is a latest-results window, not the full Swedish inventory.
- [Reed](https://www.reed.co.uk/developers/jobseeker) documents key-based Basic authentication and search pagination. Implemented search-result ingestion, disabled until access is confirmed. No UK location is inferred merely from the provider name.
- [Adzuna](https://developer.adzuna.com/overview) needs app ID and key. Existing connector can be activated once credentials and usage scope are confirmed.
- [Careerjet](https://www.careerjet.com/partners/api) requires publisher credentials and the actual triggering user's IP/user-agent. Plan a user-triggered federated query; do not manufacture these fields for scheduled ingestion.
- [USAJOBS](https://developer.usajobs.gov/guides/authentication) requires a key and registered email header. Existing connector awaits those values.
- [SmartRecruiters](https://developers.smartrecruiters.com/docs/endpoints) lists company-specific postings; the bounded public company-postings adapter is implemented but has no approved company configuration. Its [job-board feed](https://developers.smartrecruiters.com/docs/get-job-postings) needs a partner token and contains jobs submitted to that board, so it remains a separate access route.
- [France Travail](https://www.data.gouv.fr/dataservices/api-offres-demploi) includes active offers and consenting partner offers. Registration and reuse scope must be completed.
- [NAV](https://navikt.github.io/pam-stilling-feed/) documents a production-token request and an experimental public token. Production access is pending; an experimental token is not silently treated as production approval.
- [ReliefWeb](https://apidoc.reliefweb.int/parameters) requires a pre-approved appname from November 2025. Pending application/access and adapter.
- [Indeed](https://docs.indeed.com/) offers a publisher plugin route, distinct from bulk export. Existing enquiry remains pending; do not redesign the UI around an unapproved plugin.
- [LinkedIn](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access) requires authorized scopes. Its open sharing permission publishes on behalf of a user; it does not supply all employer posts. Existing human-support case remains open, with no approval recorded.
- [SEEK](https://developer.seek.com/) requires approval and describes posting/apply integrations. Unrestricted marketplace retrieval has not been established.
- [Reddit](https://redditinc.com/policies/data-api-terms) requires a separate agreement for commercial API use. [X](https://docs.x.com/x-api/fundamentals/post-cap) uses metered access. [Telegram](https://core.telegram.org/bots/api) offers scoped bot/channel access; none is currently connected.

## Implementation delivered and setup

1. JobSearch adapter uses a fixed official host, bounded pagination, original source links, occupation labels, source-provided locations and existing validation/deduplication. Explicit Sverige maps to Sweden; unknown countries remain unknown. Swedish full/part-time labels are mapped while original employment labels are retained.
2. JobSearch publication timestamps have no timezone established in this audit, so their source text is preserved without inventing an exact UTC instant. Deadline dates conservatively expire at the start of the reported day in UTC. More precise timezone handling remains a documented follow-up.
3. Reed adapter uses private `REED_API_KEY`, bounded pagination and safe error codes. Search results do not invent posting dates or full detail fields. No feed enabled and no key request duplicated.
4. Tests cover pagination/truncation, removed records, country/type mapping, credential gating and sanitized errors. Existing provider tests now select sources by type instead of array position.
5. From backend/: `npm run build`, `npm run jobs:seed`, `npm run worker:jobs`. Seeding preserves existing configurations. Reed requires an approved source configuration via `npm run jobs:configure -- path-to-config.json`; use type reed, publicListing true, enabled/approved only after access, intervalMinutes at least 60, and an explicit maxPages. Keys stay in the private environment.

## Remaining work, in order

1. Validate the new live import and maintain the country/sector audit after every rollout.
2. Complete real access onboarding for Adzuna, USAJOBS, Reed, ReliefWeb, France Travail and NAV. LinkedIn/Indeed responses and the 27 unconfirmed Jooble requests remain external dependencies; no duplicate applications or false approvals.
3. Implement authorized SmartRecruiters feeds and Careerjet user-triggered search. Add additional public employer boards across healthcare, education, manufacturing, retail, trades, agriculture, hospitality, logistics, finance and government.
4. Review the remaining regional candidates individually for current official access, commercial display rights, limits, deletion rules and coverage. The inventory clearly marks unverified routes.
5. Add authorized social-channel ingestion and distinguish hiring posts from verified structured vacancies. Do not automatically publish incomplete or stale posts as confirmed jobs.
6. Expand occupation normalization across languages, while retaining all original text and unmatched job types. No occupation should be rejected simply because it does not match a navigation category.
7. Deploy the existing frontend/backend and worker to a stable public HTTPS domain, with monitoring and regional reachability checks. Localhost is not worldwide deployment.

Completion means measured fresh coverage and working licensed connections, not merely a platform name in a configuration file. Complete worldwide platform coverage is still unfinished; provider decisions, private credentials and unresearched regional routes cannot be represented as completed code work.

## Verified result of this implementation

Checked 2026-09-11T07:31:53.144Z. 174 inventory entries; 6972 unexpired published listings. Counts are feed types, not every platform brand or all employers. 39 Jooble regions connected; 27 applications unconfirmed.

- Connected: 11
- Connector built - access/config needed: 3
- Documented API - implementation pending: 2
- Enquiry submitted - approval pending: 2
- Access required - implementation pending: 7
- Research/access route needed: 149

JobSearch initial run: four requests, 400 returned records, 399 added and one updated; all 399 unique records published. Frontend job detail returned HTTP 200 with Sweden and original source attribution. Backend build and all 29 job-engine tests passed. Worker restarted on the new build.
