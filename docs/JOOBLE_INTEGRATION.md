# Jooble feed integration

The existing job worker imports regional Jooble search results into the existing MongoDB jobs collection. The frontend consumes its normal jobs API and displays its existing cards/details; no new frontend, authentication flow or provider credentials are needed in the browser.

## Setup

In the private `backend/.env`, set only the regional keys actually issued to you, using `JOOBLE_IN_API_KEY`, `JOOBLE_AE_API_KEY`, `JOOBLE_GB_API_KEY`, etc. GB uses uk.jooble.org, US uses jooble.org, JP uses ja.jooble.org. Other country codes use the corresponding regional subdomain. Never commit these values. A regional key is not worldwide access.

From `backend/`:

```sh
npm ci
npm run build
npm run jobs:seed-jooble
npm run jobs:jooble
npm run worker:jobs
```

Seed preserves existing source configurations. `jobs:jooble` runs only due Jooble sources and respects the shared worker lease and daily cooldown. The regular worker also refreshes all other configured providers. Run the worker as a separately supervised process for unattended operation. `npm run jobs:status` exposes source results and persistent Jooble budget counters without credentials.

## Retrieval and limits

- One page (at most 100 requested results) per region every 24 hours. An empty keyword string requests broad results, with the regional country as location; this was live-tested. It is a bounded query, not a download of every job in that market or a guarantee of newest-first ordering.
- An administrator can configure `keywords` using the existing `jobs:configure` command; arbitrary occupations are supported. The existing website searches the stored catalog, not a fresh provider request on every keystroke.
- [Jooble's official API documentation](https://help.jooble.org/en/support/solutions/articles/60001448238) specifies **500 requests per key for its lifetime**. The worker caps itself at 490 per region, reserving ten for prior tests/external usage. It does not assume a daily/monthly reset. Calls made outside this worker also consume provider quota; coordinate shared key usage. Provider-approved quota expansion is required before unlimited continued use.
- Each attempt reserves a MongoDB counter before HTTP, including failed/crashed requests. Source changes and process restarts do not reset it. Exhaustion reports `JOOBLE_BUDGET_EXHAUSTED` and makes no network request. Do not delete counters to bypass quota.
- 429s use the existing provider backoff; missing credentials fail before HTTP. Transport errors cannot expose the credential-bearing request URL.

## Display and data integrity

Jobs retain Jooble attribution and the returned application/referral link. Only the provider's snippet is displayed as the description, with the existing original-listing link for full details. HTML is sanitized, duplicate jobs use the existing deduplication rules, and missing/unsafe job facts are rejected. Snippets are not expanded into invented full job descriptions or social posts.

`updated` is not treated as the original posting date. A regional search is not evidence of applicant eligibility: unknown geography remains unknown, and the region is recorded in the source configuration. The API does not independently verify that an employer is still hiring; cached listings expire after 72 hours without refresh. A partial rolling page never closes other listings simply because they are absent from that page.

39 issued keys were available at implementation. The other 27 regional requests remain unconfirmed and are not seeded. This connector does not establish direct access to LinkedIn, Indeed or any underlying board that Jooble may aggregate. See the application tracker and provider-access report for those separate dependencies.
