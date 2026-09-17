# SkillonIT Employment SEO review

Reviewed: 10 September 2026. Baseline: `codex/frontend-latest-backend`, commit `4f8253c`, containing the existing frontend and backend baseline `e4407c5`.

This is a documentation and source-code audit, not a deployed-site test or an implementation completion report. No UI, backend source, authentication configuration or secrets were changed. Neither local app was listening on its usual port during this review. The final public domain has not been confirmed.

## Requirements from the supplied documentation

The saved Enterprise Master Specification is represented by `PROJECT_SCOPE.md`, `scope-extracted.md` and `unique-requirements.md`. Requirement R-036 and sections 48, 49 and 81 require:

- Meaningful server-rendered public pages, unique canonical URLs and efficient crawling.
- Accurate, current sitemaps containing canonical public jobs; internal search results excluded from job sitemaps.
- Crawlable pagination and control of filter URL combinations.
- Timely handling of expired or closed vacancies.
- Truthful JobPosting data on eligible individual jobs, plus applicable organization and breadcrumb data.
- Protection of gated employer/contact details in HTML, metadata and structured data.
- Checks of robots, canonicals, status codes, rendered HTML, schema and Core Web Vitals.

The document supplies product requirements. It does not authorize disclosure of gated data or require invented job, salary, employer or business facts.

## Findings and priorities

| Priority | Area | Current source evidence | Required work |
| --- | --- | --- | --- |
| P0 | Production URL | `app/sitemap.ts` and `app/robots.ts` derive URLs from APP_URL, which is also used for authentication. No final domain was supplied. | Confirm a stable public origin before production indexing. Keep preview indexing disabled and avoid treating a temporary login tunnel as the production SEO domain. |
| P1 | Page metadata | `app/layout.tsx` provides a default title, description and favicon. The catch-all page derives titles from route names. No canonical, metadataBase, Open Graph or Twitter metadata was found. | Add route-specific public-page descriptions, canonical URLs and consistent sharing metadata. Social cards improve link previews; they are not a ranking guarantee. |
| P1 | Job indexability | `app/jobs/[id]/page.tsx` unconditionally returns `index: false`. | Define which real, public jobs can be indexed. Ordinary web indexing and Google job rich-result eligibility are separate decisions; do not remove noindex indiscriminately. |
| P1 | Structured data | No JSON-LD implementation was found. The Job type contains discoveredAt and expiresAt, but no explicit original employer posting date. | Add organization data from confirmed public facts. Enable JobPosting only after all required source facts and publication eligibility are established. Do not substitute discovery time for the original posting date. |
| P1 | Sitemap coverage | Only home, about, trust, contact and pricing are listed. No job inventory or accurate job modification timestamps are supplied. | Add eligible canonical job URLs using complete public inventory access, genuine modification times and partitions when needed. Do not use the current time as every URL's lastmod. |
| P1 | Discovery | Initial jobs are obtained in `app/page.tsx` and passed to the rendered component; job titles link to detail pages. Previous/Next are buttons updating client state in `components/discovery.tsx`. | Preserve the grid and styling while making pagination discoverable through real URLs and links. Add an explicit policy for query/filter URLs. |
| P1 | Crawl directives | `app/robots.ts` disallows selected private routes and all crawling in demo mode. Catch-all private/auth pages separately receive noindex. There is no explicit staging-wide metadata policy. | Review the whole route inventory and test noindex independently from crawl blocking. Robots.txt is not access control and can prevent crawlers from seeing a page's noindex directive. |
| P1 | Vacancy lifecycle | Missing/non-published jobs call notFound. Published but unavailable jobs display a closure message. All currently remain noindex. | Test closed, expired, missing and sample jobs before enabling indexing; remove active-job markup and sitemap entries when a vacancy closes. |
| P2 | Performance | Root layout fetches session information; API presentation calls use no-store and forward cookies. No current performance measurements were taken. | Measure the production build first. Any public caching must remain separate from personalized responses. Optimize assets without changing the visual design. |
| P2 | AEO and content | Public information pages exist, but no complete search-intent/answer-content review was performed. | Improve factual, useful explanations of job search and application workflows. New visible copy, FAQs or landing pages are a separate content task; avoid mass-generated thin location/category pages. |

Privacy and terms pages currently receive noindex and are absent from the sitemap. This is a policy decision to confirm, not automatically an error.

## Google Jobs data and privacy boundary

Use only the anonymous/public backend response when deciding what may be exposed to search engines. An authenticated subscription response must never feed shared metadata, JSON-LD or public caches. Existing employer masking must remain intact.

Google requires real, available individual job pages and data matching their visible content. Its documentation permits `hiringOrganization.name: "confidential"` for genuinely anonymous hiring. Paid identity masking alone does not establish that condition. The original employer posting date, truthful employment/location details and a working application route must be checked before enabling markup. Missing source facts remain a backend-owner dependency; this audit does not change the backend. [Google JobPosting guidance](https://developers.google.com/search/docs/appearance/structured-data/job-posting)

## Implementation sequence

1. **Frontend foundation:** centralized SEO settings, public-page titles/descriptions, canonicals, sharing metadata, and explicit production/preview indexing rules. Keep the current UI and authentication configuration intact.
2. **Discovery and lifecycle:** URL-based pagination, filter policy, job indexability rules, status handling and sitemap inventory. Preserve existing button/card styling and user interactions.
3. **Eligible structured data:** organization and breadcrumb entities where supported; JobPosting after the source-data contract and public visibility requirements are met.
4. **Content and launch:** agree target countries/languages and priority job categories, then review useful landing-page content. Confirm the production domain, measure performance and verify Search Console ownership before submission.

A missing production domain need not block code preparation. It does block final canonical/sitemap validation and deployment verification. Do not activate production indexing on an invented domain.

## Acceptance checks for implementation

- Render representative public pages and verify unique titles/descriptions, one correct canonical, and intended robots directives.
- Check login, registration, recovery, candidate, employer and admin routes for indexing and authorization behavior.
- Check response codes and rendered content for existing, missing, closed, expired and sample jobs.
- Confirm sitemap URLs are canonical, indexable and return the intended content; exclude private, search-only, sample and closed inventory.
- Verify navigation reaches jobs beyond page one without depending solely on button clicks or infinite scrolling.
- Validate eligible JSON-LD against visible anonymous content, including dates and remote-location facts; assert that gated fields never appear.
- Run typecheck/lint/build and targeted SEO integration tests. Perform production Rich Results/URL Inspection checks once a public deployment exists.
- Compare desktop/mobile screenshots with the existing UI and measure production performance. This audit has not run those checks.

## Current guidance checked

Canonical URLs and sitemaps should consistently identify the preferred versions of public pages. [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)

Do not rely on noindex inside a page that Google is prevented from crawling. Private data must remain protected by authentication regardless of crawl directives. [Google robots meta guidance](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)

Google says AI Overviews/AI Mode use the established SEO foundations and do not require special AI files or special schema. [AI features guidance](https://developers.google.com/search/docs/appearance/ai-features)

The current Google changelog states that FAQ rich results stopped appearing on 7 May 2026. Useful FAQ content may still help users, but FAQ rich-result promises are not part of this plan. [Google Search documentation updates](https://developers.google.com/search/updates)
