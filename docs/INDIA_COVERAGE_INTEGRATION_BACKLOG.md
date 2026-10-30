# India Coverage Integration Backlog

This backlog ranks authorized routes by expected coverage contribution and integration readiness. It does not authorize collection from any platform.

| Priority | Route | Current state | Required evidence before activation | Completion evidence |
| --- | --- | --- | --- | --- |
| 1 | Verified employer postings | Available in-platform | Employer identity verification and moderation approval | Published, verified job with a direct application flow |
| 2 | Approved employer ATS boards | Greenhouse, Lever, Ashby, and SmartRecruiters supported | Employer authorization, public board identifier, attribution rules, cadence | Successful health check, direct source form verified, India locations measured |
| 3 | NCS / DGE | Partnership required | Written MoU or API/feed approval covering retrieval and applicant-data rules | Authorized test feed, consent-preserving redirect, closure propagation |
| 4 | Jooble India | Connector available | Regional API key and approved attribution scope | Bounded daily result, request budget audit, source redirect verified |
| 5 | Adzuna India | Connector implemented | App ID/key plus approved display and caching scope | India feed health, attribution, source-link verification |
| 5 | The Muse | Connector implemented, disabled without a registered app key | App registration, API key, source-link attribution and applicable terms acceptance | Bounded feed health, source-link verification, India/remote eligibility measured |
| 6 | Naukri, Foundit, Shine, TimesJobs, Internshala, Apna, WorkIndia | Partnership required | API/feed/redistribution agreement and operating terms | Provider contract test and India geography quality report |
| 7 | Indeed and LinkedIn | Partner program required | Publisher/Talent Solutions scope that explicitly permits retrieval | Contract-approved endpoint and source-specific application behavior |

## Operating rule

Work through this list only after the partner record is completed in [`INDIA_SOURCE_PARTNER_INTAKE.md`](INDIA_SOURCE_PARTNER_INTAKE.md). A provider may move down the list only when its required evidence is complete; it must never be activated because a public consumer website is reachable.

## Activation gate

Before an approved source is enabled, record: the signed or public-authorized access basis, source owner, board/feed identifier, India geography fields, attribution text and original application URL, permitted refresh/caching limits, credential owner, health-alert contact, and a rollback owner. Verify a sample contains active India listings, preserves the source application form URL, deduplicates against existing jobs, and reports freshness plus state/industry coverage. Failed checks keep the source pending.
