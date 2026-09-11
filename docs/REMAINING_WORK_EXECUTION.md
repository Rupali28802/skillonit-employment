# Remaining-work execution status — 11 September 2026

This update supersedes earlier statements that all remaining work could be completed solely in code. Existing UI and Google authentication have not been changed.

| Workstream | Action this run | Remaining dependency |
|---|---|---|
| Country/sector measurement | Added a persisted `coverage-latest` audit after worker runs that change inventory or report failures. Audit errors preserve ingestion and report a safe failure. Exported latest actual country/sector inventory. | More local sources; country eligibility counts are not local market coverage. |
| USAJOBS | Filled official application using project contact details and reviewed terms. Kept it open in the browser. | Explicit acceptance of binding API terms is pending; application NOT submitted. |
| ReliefWeb | Followed the official appname application. | It explicitly rejects Gmail/Yahoo/Hotmail and needs an organization-domain email, which has not been supplied. No invalid application submitted. |
| Adzuna / Reed / France Travail / NAV | Confirmed no applicable credentials configured. Preserved prior Reed request without duplicate submission. | Account onboarding, terms acceptance and issued access still outstanding. |
| SmartRecruiters | Implemented bounded public company-postings listing/detail adapter, active-post filtering, fixed-host fetching and configuration validation. | A reviewed employer board and permitted display scope must be configured; NOT live or counted connected. |
| Careerjet | Kept pending; its API needs a real triggering visitor IP/user-agent, unavailable from the current untrusted proxy path. | Publisher key and a trusted visitor-aware federation integration. Do not substitute localhost or fabricated identity. |
| Social hiring posts | No invented provider tokens, channels or approvals. | Authorized source/channel access and moderation ingestion still unfinished. |
| Multilingual occupations | Added Swedish, French, Spanish, Arabic and Hindi aliases plus agriculture, manufacturing and skilled trades. Original title, description and unmatched type text remain preserved. | Broader languages, ambiguity evaluation and more source coverage; changes take effect when jobs are normalized on refresh. |
| Public deployment | Ran existing production-readiness checks. | Stable domain/hosting not provided. Redis and CV storage/scanner/parser configuration are missing; production startup intentionally remains protected. |
| Regional research | Existing candidate inventory preserved. | The remaining individual access reviews have NOT been completed. |

## Production configuration gaps (names only)

CV_PARSER_PROVIDER, CV_PARSER_TOKEN, CV_PARSER_URL, CV_PARSER_VERSION, CV_S3_BUCKET, CV_S3_REGION, CV_SCANNER_PROVIDER, CV_SCANNER_TOKEN, CV_SCANNER_URL, CV_STORAGE_PROVIDER, ENABLE_CV_UPLOADS, REDIS_CONFIG, REDIS_URL.

No secrets were added to the report. No production checks were disabled to make a development preview appear deployed.

## Access evidence

- USAJOBS application: https://developer.usajobs.gov/apirequest/ — terms require attribution, directing users to USAJOBS, and no standalone resale/feed redistribution. Application awaiting explicit terms approval.
- ReliefWeb official appname form: https://docs.google.com/forms/d/e/1FAIpQLScR5EE_SBhweLLg_2xMCnXNbT6md4zxqIB00OL0yZWyrqX_Nw/viewform — requires an organization email; free consumer mail addresses are not processed.
- SmartRecruiters contracts: https://developers.smartrecruiters.com/docs/endpoints and https://developers.smartrecruiters.com/docs/objects — company-scoped public postings; no claim of every employer network access.
- NAV onboarding: https://navikt.github.io/pam-stilling-feed/ — consumer details and written terms confirmation required for a private production token.

LinkedIn screenshots supplied by the owner say the original enquiry was transferred to another team and a new case-number acknowledgement should be used. They are not an API approval. No duplicate LinkedIn/Indeed/Jooble requests submitted this run.

## Verification

Backend build passed; all 32 job-engine tests passed. Homepage and India search returned HTTP 200. Worker restarted on current build. Saved country/sector audit contains 7,033 live listings and 4,401 with unknown geography. Inventory in 250 country/territory filters includes source-reported remote eligibility; it is not 250 complete local markets.

