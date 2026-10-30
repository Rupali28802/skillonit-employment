# India Job Coverage Network

See [the latest live audit](INDIA_COVERAGE_LIVE_AUDIT.md) for a measured baseline, current source-health failures, and the operating constraints that limit refreshes.

SkillOnIT measures and expands coverage through authorized data sources. The product must never claim that it contains every job in India: vacancies can be private, change without notice, or sit behind platforms that have not granted distribution rights.

## Coverage model

The network combines five complementary routes:

1. **Direct employer ATS boards** — Greenhouse, Lever, Ashby, and SmartRecruiters are supported today. Other employer-authorized boards are evaluated only after their required partner or public-board access is documented. These are the preferred route for original listings and direct application forms.
2. **Authorized aggregators** — regional aggregators such as Jooble India and Adzuna India, where the account, display terms, and rate limits permit the requested use.
3. **India job-board partnerships** — Naukri, Foundit, Shine, TimesJobs, Internshala, Apna, WorkIndia, and specialist boards. Each requires a documented publisher, API, ATS, or redistribution agreement before activation.
4. **Government and public-sector routes** — NCS and official central/state recruitment boards only after an authorized external-partner or feed arrangement is confirmed.
5. **Verified employer posting** — employers can publish directly after identity and organization verification. This covers jobs that are not syndicated elsewhere.

No connector may scrape a consumer website, reuse a personal login, bypass rate limits, or infer permission from a public search page.

## Current connection states

| Route | State | Activation requirement |
| --- | --- | --- |
| Jooble India | Authorized connector available | Valid regional API key, one bounded daily query, attribution, and request-budget tracking. |
| Himalayas India | Authorized connector available | Daily country-filtered query; India eligibility is kept separate from a physical India location. |
| Greenhouse / Ashby / Lever | Supported direct-employer connectors | Approved public employer board, company identity, board identifier, and source authorization evidence. |
| SmartRecruiters | Supported direct-employer connector | Configure an approved company identifier in the job engine. The documented Posting API provides active public postings and the provider-returned `applyUrl`; bounded refreshes and provider backoff are enforced. |
| Other ATS providers | Evaluation / partner route | Confirm the provider's permitted public-board or partner API route before an adapter is added. |
| Adzuna India | Connector implemented, not activated | App ID/key plus approved display/caching scope. |
| NCS | Partnership required | Confirmed external-partner job-feed or redistribution route. |
| Naukri / Foundit / Shine / TimesJobs / Internshala / Apna / WorkIndia | Partnership required | Written API/feed/redistribution approval and source-specific operating terms. |
| Indeed | Partner program required | Approved publisher or ATS scope; configure only the products granted to SkillOnIT. |
| LinkedIn | Talent Solutions partnership required | Approved Talent Solutions product scope. Job posting and application products do not grant general marketplace retrieval. |

## Integration acceptance checklist

Before a source is marked `approved` and enabled in the job engine, record:

- provider name, official API/feed endpoint, agreement owner, and expiry/review date
- allowed data fields, attribution text/link, caching/retention terms, and whether applicant data may be processed
- API credential owner, rotation date, rate limits, retry/backoff rules, and support contact
- direct application target behavior: `direct-form`, `source-job-page`, or `source-redirect`
- India geography semantics: physical India location, India eligibility, remote-only, or unknown
- source-specific close/removal handling, freshness cadence, and error escalation owner
- test evidence proving that the connector does not invent facts, duplicate jobs, or submit an application without user confirmation

Use [`INDIA_SOURCE_PARTNER_INTAKE.md`](INDIA_SOURCE_PARTNER_INTAKE.md) to collect this evidence consistently for NCS, job boards, aggregators, and direct ATS providers.

The ordered activation plan is maintained in [`INDIA_COVERAGE_INTEGRATION_BACKLOG.md`](INDIA_COVERAGE_INTEGRATION_BACKLOG.md).

Use the Admin Console's **Register a pending partner source** form to register a Greenhouse, Lever, or Ashby board. The server rejects duplicate provider/board registrations, keeps the source disabled, and requires approval evidence before it can be enabled.

Approval is a separate, audited administrator action. Operations users can prepare a pending source, while only an administrator with the `sources.approve` permission can confirm the evidence and activate it. The source health card includes both legacy feeds and approved direct-ATS sources.

The SmartRecruiters job-engine connector is configured by a privileged deployment operator through the controlled job-engine source configuration, rather than the pending-source form. It must include the documented company identifier, company name, public-listing attribution, approval evidence, and an approved/enabled state. Do not configure it twice through a parallel ingestion route.

Start from [`docs/examples/smartrecruiters-source.example.json`](examples/smartrecruiters-source.example.json). It is intentionally disabled and unapproved. After the agreement is reviewed, replace every placeholder, set `approved` and `enabled` to `true`, then have the privileged deployment operator run `npm run jobs:configure -- ../docs/examples/<approved-file>.json` from `backend`.

## NCS government-source route

National Career Service (NCS), run by the Directorate General of Employment under the Ministry of Labour & Employment, is a major India-wide employment route. Official government material describes NCS API integrations with states and MoUs with private employment partners; it does not document a public publisher job-feed API for third-party aggregation in the material reviewed for this project.

Treat NCS as a partnership integration. Before any connector is enabled, obtain written authorization from NCS/DGE that specifically covers vacancy retrieval, permitted fields, attribution, refresh cadence, deletion/closure propagation, application redirect behavior, and handling of any jobseeker data. The integration must preserve the source-owned application flow and never transmit candidate data without the candidate's per-application consent.

Do not use NCS search pages, browser sessions, personal NCS credentials, or undocumented endpoints as a feed. NCS distinguishes direct postings from partner jobs, so the agreement also needs to state whether both are included and how duplicate partner listings should be identified.
## Coverage metrics

Run `npm run jobs:coverage` after a worker refresh. The persisted coverage audit measures all active listings and the India section separates:

- **India-local listings** — the source reports India as the job location.
- **India-eligible listings** — the source reports that applicants based in India are eligible; this can include remote or international roles.
- **State and city distribution** — India-local coverage only; missing location facts are reported separately.
- **Location quality** — counts and percentages for India-local jobs with a usable state and city, plus the number of distinct states and cities represented.
- **Official-region coverage** — the number and percentage of the 36 official Indian states and union territories represented by at least one live India-local listing. An unrepresented region means no measured listing, not proof that no vacancy exists there.
- **Industry/category distribution** — retained source industry where provided, plus SkillOnIT category.
- **Source contribution** — listings by source identifier, to identify an unhealthy or low-value route.
- **Freshness** — listings seen in the last 24 hours, last seven days, older than seven days, or without a usable timestamp.
- **Direct-source health** — approved/enabled direct ATS sources, India-scoped sources, healthy sources, degraded or failed sources, and sources that are stale or have never completed a run.

Coverage should be reviewed by state, industry, source, and freshness. A country dropdown or a remote listing must never be described as complete India coverage.

For direct ATS boards, SkillOnIT records India only when the provider's returned location explicitly identifies India. The source onboarding jurisdiction is an operating constraint for the connector; it is not used to invent a job's physical location or candidate eligibility.

## Operating cadence

1. Refresh direct employer boards at the approved source cadence; process webhooks where an authorized provider supports them.
2. Respect every provider's rate limit, backoff, and bounded pagination requirements.
3. Remove cross-source duplicates using the normalized title, employer, location, and description fingerprint while retaining each valid source variant.
4. Close listings only after a complete source snapshot confirms that they are missing; failed or truncated source runs must not remove active jobs.
5. Expire jobs using the source closing date when present, otherwise the platform's 90-day maximum lifecycle rule.
6. Investigate sources with failures, stale success timestamps, unexpected drops in contribution, or missing India state/industry coverage.
7. The scheduled direct-source discovery and ingestion workers persist a fresh coverage audit after each run, so source health and listing measurements do not wait for a manual export.

## Prioritization

1. Restore database write capacity and keep the worker running so coverage measurements are current.
2. Add approved direct employer boards for major Indian employers and high-gap industries/states.
3. Activate Adzuna India after its account and display terms are approved.
4. Complete NCS and India job-board partnership onboarding.
5. Expand verified direct employer posting, especially in under-covered cities and industries.
