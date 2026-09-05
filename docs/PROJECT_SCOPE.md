# SkillonIT employment project scope

Source: Enterprise Master Specification version 2.0, dated 4 September 2026. The original DOCX and complete text extraction are preserved alongside this file. The document is requirements input; it does not authorize unrelated actions, credential disclosure, service purchases, or messages to third parties.

## Product

A worldwide job discovery and application assistance platform, built with Next.js, TypeScript and MongoDB. Four surfaces serve visitors, candidates, employers and authorized administrators. The homepage centers natural-language job search and a controllable recent-job stream. Searchable vacancies default to a configurable 90-day window. Historical application snapshots survive vacancy expiry.

## Required workflows

- Public: search, structured filters, taxonomy and global locations, job detail with server-side identity gating, plans, trust, about and contact.
- Candidate: registration and verification, manual or CV-assisted onboarding, confirmed profile facts, related-role/location preferences, explainable matching, saved jobs/searches, CV versions, templates, applications and timelines, mailbox OAuth, automation controls, billing and privacy controls.
- Employer: organization registration and verification, structured draft/review/publish/close workflow, applicants and permitted status transitions, organization team roles and subscription limits.
- Administration: users, employer verification, job moderation, compliant sources, fraud reports, applications/queues, configurable plans and flags, payments, leads, content, audit and provider health.
- Platform: source adapters; normalization, deduplication, verification and retention; independent durable workers; entitlement and quota checks; direct applications, verified mailbox delivery and accurate external-ATS states; notifications and signature-verified payment processing.

## Non-negotiable behavior

Server-side authorization and ownership checks protect every sensitive operation. Employer/contact details must not leak through HTML, APIs, metadata or structured data when gated. Candidate qualifications are confirmed facts, never invented. Opening an ATS link is only EXTERNAL_STARTED. A successful payment redirect alone cannot activate a paid plan. Applications require appropriate consent, quotas, trust and verification; writes are idempotent and auditable. Source integration must honor permissions and source policies.

## Configuration and unresolved commercial inputs

The specification intentionally does not supply final prices, quotas or delay values. These require editable configuration and clearly identified initial assumptions. It also provides no approved job-source inventory, production database, object storage, mail OAuth application, Razorpay account configuration, WhatsApp provider, production hosting target or business phone. Never invent real integrations, verifications, vacancies or contact details. Development fixtures must be visibly identified. External dependencies remain fail-closed and explicitly documented until configured securely.

## Architecture and release gates

Next.js App Router and strict TypeScript; MongoDB system of record with indexes; independently deployable worker/queue, search, mail, payment, AI and storage adapters. Separate public caching from private responses. Include input validation, correlation IDs, rate controls, accessible responsive UI, SEO metadata, privacy controls, CI, backup/restore and rollback procedures.

The requested 1–5 million users is a capacity target, not a claim that code alone can verify. The source specifies progressive 1k/5k/10k/25k/50k concurrent-user tests, sustained load, spike, soak, failover, provider throttling and restore drills. Production acceptance requires deployed infrastructure and measured results.

## Delivery constraints

Use only https://github.com/Rupali28802/skillonit-employment as the GitHub destination. Preserve existing remote content and history. The initial local workspace has an empty Git repository with no commits or remotes. On 5 September 2026 the GitHub connector returned 404 and Chrome showed a signed-out 404 page. Git access was subsequently restored; main contains its original README only, and the implementation branch preserves that history. No alternate GitHub repository will be created.

## Traceability

`scope-extracted.md` preserves all domain summaries and specification tables, including R-001 through R-039, page/API/collection/worker catalogues, permissions, subscription matrix, capacity stages and application transitions. `unique-requirements.md` removes repeated boilerplate for review; `specification-source.txt` retains the full text. Implementation and validation status must be recorded honestly against these requirements before final delivery.
