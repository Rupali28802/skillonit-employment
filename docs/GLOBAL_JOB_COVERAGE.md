# Worldwide job coverage audit — 10 September 2026

This is a prioritized source inventory, not a claim that every platform has been integrated or that every job is obtainable. New employers, private groups and local boards appear continuously. Country selection, actual indexed jobs, eligibility to apply, and worldwide website availability are separate measurements. The local preview is not a globally deployed service.

## Platform list and integration decisions

| Platform | Geographic scope / role | Audit status and next action |
| --- | --- | --- |
| [Arbeitnow](https://www.arbeitnow.com/blog/job-board-api) | Europe; general occupations | Connected public feed, bounded rolling pages; incomplete inventory. |
| [Arbeitnow UK](https://www.arbeitnow.com/blog/job-board-api) | UK; general occupations | Connected public feed, bounded rolling pages. |
| [Remotive](https://github.com/remotive-com/remote-jobs-api) | Remote with country restrictions | Connected; delayed public data, attribution and public access required; no redistribution to Google Jobs. |
| [Jobicy](https://jobicy.com/jobs-rss-feed) | Remote with country/region restrictions | Connected and live-tested: 200 jobs imported. Max 200 latest results; hourly maximum polling, six-hour configured interval. |
| [Himalayas](https://himalayas.app/docs/remote-jobs-api) | Country-filtered remote jobs | Implemented daily country searches across the 250-entry directory and a separate worldwide query; initial sweep status is in the snapshot. One bounded page per country, worldwide substitutes excluded. |
| [Remote OK](https://remoteok.com/faq) | Remote jobs with original source attribution | Implemented daily public-feed adapter; live status is in the snapshot. |
| [Adzuna](https://developer.adzuna.com/overview) | Country-specific general job aggregation | Connector implemented and fixture-tested, not live activated; app ID/key and publication/caching agreement required. No credentials provisioned in this task. |
| [Jooble](https://jooble.org/api/about) | International job aggregation | Documented search API; provider key and agreed retrieval/caching quotas needed; not connected. |
| [Careerjet](https://www.careerjet.com/partners/api) | International/localized search | API verified; requires publisher key and real triggering user's IP/user-agent. Use a future user-triggered federation adapter, not fabricated visitor data in a scheduled crawler. |
| [USAJOBS](https://developer.usajobs.gov/api-reference/get-api-search) | US federal jobs, including overseas duty stations | Connector implemented and fixture-tested, not live activated; API key/registered email required. Eligibility is announcement-specific. |
| [Reed](https://www.reed.co.uk/developers/jobseeker) | UK general jobs | Search/details API verified; API key and agreed usage required; not connected. |
| [Indeed](https://docs.indeed.com/) | International general jobs | Partner documentation includes publisher search plugin; not assumed to grant bulk storage or unrestricted job export. Partner provisioning required. |
| [LinkedIn](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview) | International professional jobs/posts | Posting API is not an unrestricted search feed. Retrieval agreement required; not connected. |
| [SEEK](https://developer.seek.com/) | Australia/NZ and Asia-Pacific ecosystem | Integration approval required; documented posting/application APIs are not assumed to grant all-marketplace extraction. |
| [Bayt](https://www.bayt.com/en/jobs/locations/) | UAE/GCC/MENA, other listed markets | Job inventory verified; redistribution/feed access not established. Priority UAE partnership. |
| [NCS](https://www.ncs.gov.in/job-seeker/pages/search.aspx) | India and listed international vacancies | Public search verified; syndication access not established. Priority India source. |
| [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api) | Employer-specific global boards | Connector implemented; approved employer board configuration needed. |
| [Greenhouse](https://developers.greenhouse.io/job-board.html) | Employer-specific global boards | Connector implemented; approved employer board configuration needed. |
| [Lever](https://github.com/lever/postings-api) | Employer-specific global boards | Connector implemented; approved employer board configuration needed. |
| [SmartRecruiters](https://developers.smartrecruiters.com/docs/posting-api) | Employer-specific global boards | Posting API documentation identified; adapter and employer review pending. |

The following regional/specialist inventory is a discovery backlog. Listing a name does **not** assert that its current API, terms, availability, brand ownership or countries have been verified. Each needs an official endpoint/terms review before connection; none is silently counted as connected.

| Region / source class | Platforms to evaluate individually |
| --- | --- |
| Global/general | Glassdoor, ZipRecruiter, Monster, Talent.com, Jobrapido, JobisJob, Google Jobs (discovery surface, not assumed export API), Wellfound, Welcome to the Jungle |
| India | Naukri, Foundit, Shine, TimesJobs, Apna, WorkIndia, Internshala, Cutshort, Hirist, iimjobs, Freshersworld, Unstop; official UPSC/SSC/state recruitment boards |
| UAE/GCC/MENA | GulfTalent, Naukrigulf, Dubizzle Jobs, Dubai Careers, FAHR, MOHRE, Qatar Living Jobs, Saudi Jadarat, Akhtaboot, Wuzzuf, Forasna, Tanqeeb |
| UK/Ireland | Totaljobs, CV-Library, Find a job (DWP), NHS Jobs, Civil Service Jobs, jobs.ac.uk, IrishJobs, Jobs.ie |
| US/Canada | CareerBuilder, Dice, Built In, Handshake, HigherEdJobs, GovernmentJobs, Canada Job Bank, Workopolis, Eluta, provincial/state/local government portals |
| Australia/NZ | Jora, Workforce Australia, APS Jobs, EthicalJobs, Trade Me Jobs, jobs.govt.nz |
| Continental Europe | EURES, Europass, France Travail, APEC, Bundesagentur für Arbeit, StepStone, XING, InfoJobs, Infoempleo, Pracuj, Jobs.cz, Profession.hu, OLX employment sections, national public employment services |
| East/Southeast Asia | JobStreet, JobsDB, MyCareersFuture, Glints, Kalibrr, VietnamWorks, TopCV, 104 Job Bank, 1111, Wantedly, Daijob, GaijinPot, Rikunabi, Mynavi, JobKorea, Saramin, BOSS Zhipin, Zhaopin, 51job |
| South/Central Asia | Bdjobs, Rozee, Mustakbil, topjobs.lk, Merojob, JobsNepal, regional public employment services |
| Africa | Jobberman, BrighterMonday, MyJobMag, Fuzu, PNet, Careers24, CareerJunction, regional government and NGO boards |
| Latin America/Caribbean | Computrabajo, Bumeran, ZonaJobs, OCC, Get on Board, Catho, InfoJobs Brazil, elempleo, Konzerta, CaribbeanJobs |
| Remote/freelance/gig | We Work Remotely, Working Nomads, Remote.co, FlexJobs, Remotely, Upwork, Freelancer, Fiverr, PeoplePerHour, Toptal; distinguish gigs/services from employment vacancies |
| NGOs/research/specialists | ReliefWeb, UN Careers, UNjobs, Impactpool, Idealist, EURAXESS, Nature Careers, Science Careers, Hcareers, CatererGlobal, Rigzone, Energy Jobline, Aviation Job Search |
| Employer ATS/careers | Workday, Oracle Recruiting, SAP SuccessFactors, iCIMS, Workable, BambooHR, Teamtailor, Recruitee, Personio, Pinpoint, Zoho Recruit; per-employer approved feeds, sitemaps/JobPosting pages or supplied exports |
| Social/community | LinkedIn posts, Facebook pages/groups, X, Reddit, Telegram channels, Discord servers, WhatsApp communities, Slack communities, university/alumni boards, recruitment agencies, newsletters. Requires scoped access and verified original vacancies; no private-group harvesting or fabricated API access. |

## Country expansion order and current gaps

1. India: Adzuna India after access approval; NCS and local-board agreements; direct employer inventories across healthcare, trades, education, government and services.
2. UAE: Bayt/GulfTalent/Naukrigulf/Dubai Careers review and employer boards. Adzuna is **not** assumed to support UAE. Remote listings mentioning UAE alone are not UAE-wide coverage.
3. UK: current Arbeitnow UK plus approved Adzuna/Reed; NHS/public sector and direct employers.
4. Australia: approved Adzuna plus SEEK partnership; Workforce Australia/APS and direct employers.
5. US: approved Adzuna/USAJOBS plus partner feeds and direct employers. Canada handled separately, not inferred from US inventory.
6. Every remaining ISO country/territory: maintain explicit zero/unknown counts, assign national employment portal + local general board + employer sources. Prioritize based on missing published inventory; never translate a country dropdown into a coverage claim.

## Acceptance criteria

- All ISO 3166-1 country/territory filters supported, plus explicitly worldwide listings; remote never automatically means worldwide or visa sponsorship.
- Arbitrary occupations searchable through original title, source category, skills, job type and description. Category labels are navigation, not an admission allowlist. Preserve unmatched occupations.
- Full-time, part-time, permanent, contract, temporary, internship, apprenticeship, freelance and volunteer text searchable; missing employment type remains unknown.
- Record source attempts, delays, truncation, errors, actual published country/category counts and unknown geography. Re-run the coverage report after ingestion.
- Credentials stay in private environment variables. Account approval, paid access and provider contracts are external dependencies, not completed integrations.
- Public HTTPS deployment, regional uptime probes, performance, localization, accessibility and any infrastructure geoblocking still require a separate deployment audit. No country reachability tests can establish worldwide availability from localhost.

## Delivery status

Audit baseline: 3 active feeds and 3 employer connectors. Delivered: fourth live feed (Jobicy), Adzuna/USAJOBS adapters fixture-tested but disabled without access, all-country filtering, broad keyword/job-type search, and a measured coverage report. Other rows remain explicitly pending. This inventory must be maintained rather than treated as a final list of every platform in existence.

Before the Himalayas rollout, the audit recorded 1,046 searchable listings: 25 countries had explicit inventory; 10 listings said worldwide, and 776 had unresolved geography. India and UAE were zero at that point. The refreshed [live coverage snapshot](GLOBAL_COVERAGE_SNAPSHOT.json) is authoritative for the subsequent sweep and includes per-country feed statuses. Multi-country records contribute to more than one country count. Older records receive improved metadata at their normal refresh. Do not market full India/UAE/global coverage from either snapshot.

Verification after worldwide expansion: 60 backend tests passed, including 23 engine tests; frontend production build, typecheck and lint passed; 31 isolated frontend/Express checks passed. Browser inspection confirmed 250 country/territory choices plus All/Worldwide and nine job-type choices. Paid/credential-gated providers were tested using fixtures only. Public HTTPS hosting and country-by-country reachability remain unverified.

The expansion adds regression coverage for live seconds/milliseconds timestamps, canonical policy comparison, country eligibility, attribution, and per-provider 429 backoff, Himalayas attribution separate from direct application links, and source-provided timezone restrictions. Country results represent the provider’s reported restrictions; original employer requirements remain authoritative. `npm run jobs:seed-worldwide` is idempotent and provisions the country sweep without changing existing policies. No restricted-platform credentials were supplied or purchased. Jooble/Adzuna/Reed/USAJOBS and platform-specific partnerships remain external dependencies; the public API rollout cannot complete every platform's integration.

### Completed public-source sweep

The saved snapshot contains 2,747 published listings, including 74 explicitly eligible for India and 59 for the United Arab Emirates. All 250 country/territory entries have source-reported inventory after resolving ISO/English naming aliases; 30 worldwide listings remain separate. All 251 Himalayas queries (250 countries plus worldwide) finished without a remaining failure; 248 are bounded partial results, three reached the end of their returned query. Remote OK imported 99 listings. These are provider-reported restrictions, predominantly remote jobs, not complete local markets or independently verified employer eligibility. 832 other records still have unresolved geography. No LinkedIn, Indeed, regional-board or social-platform access is implied.

An initial timestamp-unit and source-policy serialization issue was corrected, regression-tested, and affected imports retried. Existing Himalayas records were backfilled only from their preserved reported location restrictions, with no additional provider requests or inferred locations. Daily worker and API restarted on the corrected build.
