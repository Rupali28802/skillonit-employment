# Provider access applications — 10 September 2026

Current status: 39 Jooble regional credentials verified; 27 regional submissions have no visible confirmation. Indeed publisher enquiry submitted; approval pending. Reed registration remains unverified. Earlier sections below preserve application research/history.

## Confirmed project details

Product: SkillonIT Employment. Contact email supplied by owner: skillonitemployment@gmail.com. Next.js frontend and Node/Express/MongoDB backend. Working local preview: http://localhost:3000/. Existing job search preserves source credit and original application links. Country eligibility comes from source data; indexed counts are not traffic or customer counts.

## Application routes

| Provider | Correct request | Missing information / dependency |
| --- | --- | --- |
| [Reed](https://www.reed.co.uk/developers/jobseeker) | Jobseeker search/details API key; signup form opened in browser | Authorized contact first/last name; email is known. Provider issuance/verification still required. |
| [Jooble India](https://in.jooble.org/api/about) | India-specific search API access | Contact full name, position, public website, business phone. |
| [Jooble UAE](https://ae.jooble.org/api/about) | UAE-specific search API access | Same contact details; separate regional key. |
| [Jooble US](https://jooble.org/api/about) | US-specific search API access | Same details; extend to other regional domains only after confirming actual supported markets. |
| [Adzuna](https://developer.adzuna.com/signup) | Job-ad search API registration | Username/account login, company name/website, API use case, actual monthly visitors; confirm publication/caching rights and quota. |
| [Indeed Trusted Media Network](https://www.indeed.com/partners/network) | Publisher job-content feed partnership, not ATS posting API | Public website, authorized contact and accurate company/audience details; partner review and feed provisioning. Form opened in browser. |
| [LinkedIn hiring partnerships](https://business.linkedin.com/hire/ats-partners/partner-application) | Ask whether a licensed job-discovery/redistribution partnership exists for this use case | Published form lists recruiting/posting/apply integrations, not unrestricted search export. Do not select an unrelated integration to obtain keys. Requests company website/HQ, contact, customers, largest customers and daily active jobs. Unknown fields must be supplied accurately. |

Jooble confirms that API keys are regional, not worldwide: [official connection guidance](https://help.jooble.org/en/support/solutions/articles/60000922689-how-to-connect-to-the-jooble-rest-api).

## Prepared request text

Subject: Job discovery API / licensed publisher feed access — SkillonIT Employment

We are developing SkillonIT Employment, a job-discovery platform with a Next.js frontend and an Express/MongoDB backend. We would like permission to display your current job listings in our existing search interface, with required attribution and links to the original job/application page.

Please confirm whether your publisher/search API or licensed feed supports this use case, which countries and employment types it covers, and how to apply. We need the permitted fields, caching and retention rules, refresh limits, expiration/removal requirements, attribution/tracking requirements, pricing and any traffic or company eligibility criteria. We will enable only the access and markets you approve.

For Jooble, request a separate key for the regional domain concerned. For Indeed, request Trusted Media Network publisher onboarding. For LinkedIn, first ask whether job-discovery redistribution is offered; do not describe our product as an established ATS partner or claim customer numbers that have not been verified.

## Owner information needed before submission

- Authorized contact full name and role.
- Company/legal name and headquarters country.
- Public website/domain; if none exists, report pre-launch/local development honestly.
- Business contact phone where the form requires it.
- Actual traffic/customer figures where required; do not substitute indexed job counts.

Use the previously supplied business email. Do not request passwords, OTPs or API keys in chat. No paid plan has been selected, no application has been submitted, and no partner agreement has been accepted. Approved access must be verified by a real provider response before a connector is marked connected. Public deployment requires a chosen domain and hosting destination; localhost cannot serve as the production website.
## Indeed submission confirmation

The owner submitted the Trusted Media Network enquiry. On 10 September 2026, the live browser page at https://www.indeed.com/partners/network#mod-5 displayed: "Thank you and we will be in touch soon." Submission is confirmed; partner approval, credentials and feed access are still pending. Submitted contact details were not visible on the confirmation page and were not copied into this document. Do not submit a duplicate request.
## Reed registration follow-up

On 10 September 2026 the owner reported: "Your request has failed due to an unexpected error!" A single controlled retry used the supplied business email. The resulting page showed the collapsed registration form without a visible success confirmation; no issued key or email confirmation was verified. Status remains unverified, not connected. Do not repeatedly resubmit. Check the business inbox and Spam for a provider response before retrying or escalating. The connected Gmail account was not the intended business account, so its messages were not searched.
## Jooble India credential verified

On 10 September 2026 the owner completed the India registration. The provider page displayed "Your API key is ready" and a default limit of 500 requests, without an explicit reset period in that message. The key was stored only in ignored, untracked backend/.env as JOOBLE_IN_API_KEY. One POST to the official India endpoint returned HTTP 200 and 30 jobs for a software/India query. Access is verified for India; no other market or bulk scheduled ingestion is implied. No duplicate application should be submitted. Review quota period, usage rules and feed implementation before enabling recurring consumption. Never copy the credential or the credential-bearing endpoint into this report.
## Jooble UAE credential verified

On 10 September 2026 the provider displayed "Your API key is ready" after the owner's UAE registration. The credential was stored only in ignored, untracked backend/.env as JOOBLE_AE_API_KEY. One POST to the official UAE endpoint for software/Dubai returned HTTP 200 and 30 jobs. The page states a default 500-request limit without a reset period. UAE access is verified; scheduled feed integration remains pending quota/usage review. No credential is recorded here and no duplicate request should be submitted.
## Jooble UK credential verified

On 10 September 2026 the provider displayed "Your API key is ready" after the owner's UK registration. The credential was stored only in ignored, untracked backend/.env as JOOBLE_GB_API_KEY. One POST to the official UK endpoint for software/London returned HTTP 200 and 30 jobs. The displayed default 500-request limit has no stated reset period. UK access is verified; scheduled feed integration remains pending quota/usage review. Do not record credentials here or resubmit the application.
## Jooble US credential verified

On 10 September 2026 the provider displayed "Your API key is ready" after the owner's US registration. The credential was stored only in ignored, untracked backend/.env as JOOBLE_US_API_KEY. One POST to the official US endpoint for software/New York returned HTTP 200 and 30 jobs. The displayed default 500-request limit has no stated reset period. US access is verified; scheduled feed integration remains pending quota/usage review. Do not record credentials here or resubmit the application.
## Jooble Australia and remaining regional requests

On 10 September 2026 Australia displayed an issued API key. It was saved privately as JOOBLE_AU_API_KEY in ignored backend/.env. One software/Sydney test returned HTTP 200 and 30 jobs. The existing five regional credentials (India, UAE, UK, US, Australia) must not be requested again.

The owner authorized reusing the same details for all Jooble forms. The official country directory at https://jooble.org/ lists 66 regional sites; the remaining 61 are tracked in JOOBLE_APPLICATION_TRACKER.json. The completed Australia form did not retain contact details when reopened; no second submission was made. Position, phone and website must be recovered from user input or a filled visible form before further submissions. No contact values were invented. Name/email are already known from the owner's prior entries.

## Jooble Canada credential verified

The owner submitted Canada before the contact fields could be read. The live page confirmed key issuance. JOOBLE_CA_API_KEY was saved only in ignored, untracked backend/.env. One software/Toronto request returned HTTP 200 and 30 jobs. Six country credentials are verified; 60 regional applications remain pending the same contact role, phone and website. No duplicate Canada request was sent.

## Completed owner-authorized regional form pass

The owner supplied the contact role, business phone and localhost website and authorized using the same details on all regional forms. All 60 remaining country forms were filled and submitted. 33 newly issued keys were stored privately and each passed one official regional API test; together with six previously verified keys, total verified access is 39 of 66 regional sites. The other 27 forms returned without a visible issued-key confirmation and remain response_unconfirmed, not approved or connected. The unsuccessful fill verification on Slovakia was resolved by visually checking its populated fields before the first submission. No existing issued key was re-requested.

See JOOBLE_APPLICATION_TRACKER.json for per-domain outcomes. The supplied localhost URL does not establish a publicly reachable production website. Default quota is stated as 500 requests with no reset period specified on the issuance screen. Website feed integration, quota clarification and public deployment remain outstanding. All credentials are exclusively in ignored, untracked backend/.env. This pass did not modify application code or UI.

## Integration update — 11 September 2026

All 39 issued Jooble keys are now connected to the existing catalog. Initial bounded sweep: 3,800 fetched, 3,452 published, 348 rejected, one empty regional response (Dominican Republic). See JOOBLE_FEED_SNAPSHOT.json. The 27 unconfirmed submissions remain unchanged. No new form submissions were made.

Jooble official REST API documentation https://help.jooble.org/en/support/solutions/articles/60001448238 clarifies the free allowance is 500 lifetime requests per key. Earlier notes recording an unknown reset period are superseded by this guidance; the worker never resets its persistent budget automatically.

LinkedIn partnership form reviewed again in the browser. Customer region, company HQ, customer count and largest customers are mandatory; these must be supplied accurately. More fundamentally, its integration selector does not offer general job-search/post redistribution. A separate provider confirmation of that use case is required; selecting Job Postings would not establish retrieval rights. Indeed publisher enquiry is still pending. No approval or connected feed is claimed for either.
