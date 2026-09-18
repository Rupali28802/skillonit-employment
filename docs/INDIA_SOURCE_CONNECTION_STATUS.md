# India source connections — 18 September 2026

This operational audit covers the existing `codex/job-hunting-engine` deployment. See `INDIA_SOURCE_CONNECTION_STATUS.json` for measured source states and counts. Counts change during ingestion.

## Connected routes

- **Jooble India:** fresh import succeeded at 05:00:09 UTC on 17 September: 100 fetched, 41 added, 59 updated, zero rejected. Existing regional key and enabled connector; bounded daily import of one page (up to 100 records). `partial` means a bounded result set, not all Jooble vacancies. The worker tracks lifetime requests and does not reset its budget on restart.
- **Himalayas India:** successful import on 17 September; 20 records fetched and added. Country-filtered remote eligibility is distinct from a physically located Indian vacancy.
- **Razorpay / Greenhouse:** successful import on 17 September; 20 fetched, 2 added and 18 updated.
- **Ema / Ashby:** successful import on 17 September; 45 fetched, 1 added, 22 updated and 22 rejected by validation. Rejected records are not counted as published jobs.
- **Employ / Lever:** existing enabled employer connection; consult the JSON for the latest refresh result.
- **Seven additional official Lever employer boards:** 100ms, Acceldata, RapidAI, Brillio, Meesho, Level AI and Zadara were validated against Lever's public Postings API, configured and imported on 18 September. The first completed pass produced 317 active published vacancies, including 234 listings explicitly located in or eligible for India. Every listing retains its employer board URL and original application link. These are direct employer-published vacancies; this does not imply that the employers have endorsed SkillonIT.

Employer feeds are configured for ten-minute refresh. The current worker processes sources sequentially; a long worldwide pass can delay that cadence. Provider-specific limits still apply. This is a running local worker, not a 24/7 hosted deployment.

## Access holds

| Source | What is missing |
| --- | --- |
| LinkedIn / Indeed | Existing enquiries have no confirmed retrieval/display approval. Do not submit duplicates or substitute a job-posting API for retrieval access. |
| Adzuna India | Backend lacks app ID/key; confirm account/display scope before activation. Connector already exists. |
| Naukri, Foundit, Shine, TimesJobs, Internshala | Official feed/API access and redistribution scope remain unconfirmed. These are not connected. |
| Apna | Authorized feed/redistribution agreement required; public terms prohibit automated copying. |
| NCS | External partner route documented; no approved outward job feed for this project confirmed. |

## References checked

- Jooble regional keys and lifetime quota: https://jooblehelpcenter.freshdesk.com/en/support/solutions/articles/60001448238-rest-api-documentation
- Adzuna search API: https://developer.adzuna.com/overview
- Apna terms: https://apna.co/terms-of-service
- NCS external partner manual: https://www.ncs.gov.in/Documents/User%20Manual_External%20Partner.pdf
- Lever Postings API: https://github.com/lever/postings-api

No credentials are included in this report. Source-import success does not imply employer verification, guaranteed availability, or complete national coverage. Original source and application links remain attached to listings.
