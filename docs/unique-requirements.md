1. Executive Vision and Product Principles
SkillOnIT Automated Job Portal is a worldwide employment discovery and application-assistance platform. It reduces fragmented job hunting by aggregating permitted recent vacancies, normalizing and verifying them, matching them to candidates and helping candidates apply through verified email, direct employer submission or guided external application.
2. Business Model and Success Metrics
The business combines student subscription revenue, employer subscription revenue and future optional recruitment services. Metrics must reward relevance and trust, not raw application volume.
3. Personas, Roles and Permission Model
Every user and service identity must have an explicit role, permission scope and data-visibility boundary.
4. Global Information Architecture
The product consists of a public discovery site, authenticated student portal, employer portal, admin console and background platform services.
5. Homepage and Live Job Stream
The homepage is a ChatGPT-like job discovery surface with a central natural-language search bar and a live feed of newly captured jobs.
6. Authentication and Identity
Authentication must be secure, recoverable, privacy-conscious and role-aware for students, employers and administrators.
7. Student Onboarding
Onboarding must create a reliable candidate profile quickly through CV parsing or manual entry and must capture separate consents for automation and mailbox access.
8. Student Profile and CV Intelligence
The candidate profile is the canonical source for matching and applications. CV parsing is advisory until the candidate confirms extracted facts.
9. Job Preferences and Matching Controls
Candidates control target roles, related roles, experience, locations, work mode, salary, exclusions and automation constraints.
10. Global Occupation Taxonomy
The system must represent all major private-sector occupation families, not only software/IT, through an extensible hierarchical taxonomy.
11. Global Location Model
Locations must support worldwide country-region-city data while providing India-specific state/UT filtering and future geospatial capabilities.
12. Job Source Strategy
Job supply should come from a portfolio of compliant sources rather than dependency on one portal or one scraper.
13. Job Hunting/Discovery Engine
The discovery engine continuously acquires permitted job records using source adapters, source-specific schedules, retries and health monitoring.
14. Source Compliance and Governance
Every source must have an explicit compliance status, permitted method, rate policy and provenance rules.
15. Ingestion Pipeline
Discovered records flow through fetch, parse, normalize, classify, deduplicate, verify, enrich, index, match and publish stages.
16. Canonical Job Data Model
A canonical job record must preserve both normalized searchable fields and source provenance.
17. Deduplication and Reposting
Duplicate jobs must collapse to canonical opportunities while preserving source variants and identifying true reposts.
18. 90-Day Retention and Lifecycle
The public/searchable inventory defaults to the latest 90 days. Historical application snapshots remain available even after source jobs expire.
19. Employer Verification
Employers are verified through domain, website, trusted-source, direct evidence and behavior signals. Verification status is risk-based.
20. Recruitment Email Verification
Recruitment destinations must pass syntax/domain consistency and fraud checks before auto-application is allowed.
21. Fraud and Scam Detection
Trust controls must identify impersonation, payment scams, credential harvesting, malicious redirects, suspicious domains and user-reported abuse.
22. Search Architecture
Search combines structured facets, full-text relevance and semantic retrieval with clean pagination and saved searches.
23. Job Filters
Users can filter by role, related role, skills, country, India state, city, experience, fresher/internship, work mode, salary, industry, company type, MNC/top-company and trust.
Experience filters must support fresher, 0–1, 1–3, 3–5, 5+ and exact min/max ranges.
India users can choose all-India, specific states/UTs and cities; global users can choose one or many countries/regions.
Related-role matching allows Full Stack Developer to include Software Developer, Web Developer and configured aliases without forcing unrelated roles.
Candidates may explicitly select which related role families they accept.
MNC/top-company filters must use curated employer metadata, not keyword guessing.
24. AI Matching and Ranking
Matching separates relevance from auto-apply eligibility and provides explainable match reasons.
25. Job Detail and Identity Gating
Job detail pages reveal useful facts while commercial gating protects company/contact identity without leaking gated data in client payloads or metadata.
26. Student Plans and Entitlements
Basic, Pro and Premium are configurable entitlement bundles controlling limits, timing, automation, visibility and support features.
27. Application Eligibility Rules
No job may enter the automation queue unless the user, plan, profile, job, destination and policy all satisfy eligibility rules.
28. Application Scheduling and Priority
Plans may control how quickly eligible applications are queued after a job is verified, including premium near-immediate application.
Basic, Pro and Premium delay windows are configurable by Admin and can vary by application method.
Premium may receive immediate or near-immediate queue priority after job verification; this is a service priority, not a guarantee that employers will see it first.
Delay starts only after the job becomes verified/eligible, not merely after raw discovery.
Queue ordering must respect fairness, provider quotas and anti-spam safeguards.
Users can pause automation globally or per saved search/role.
29. Verified Email Application
When a verified recruitment email exists, the platform may send from the candidate-authorized mailbox with the selected CV and approved template.
30. Mailbox OAuth and Permissions
Mailbox connectivity must use provider-supported OAuth/delegated access with least privilege and revocation.
31. Application Templates
Candidates control versioned subject, body, signature and CV combinations; template variables must never fabricate facts.
32. External ATS/Application Links
For jobs requiring an employer website or ATS, the system opens the canonical application path and tracks progress without falsely claiming submission.
33. Direct SkillOnIT Applications
Jobs posted directly by verified employers can receive platform-native applications and recruiter status updates.
34. Application Tracking
Every application has a traceable state machine and immutable snapshot of the candidate/job/template used.
35. Student Dashboard
Students see matches, saved jobs, queued applications, sent applications, external actions, replies, interviews, subscription usage and automation controls.
36. Employer Registration and Verification
Employer onboarding establishes organization identity, business contact, domain verification and team ownership.
37. Employer Job Posting
Employers create structured jobs with draft, preview, publish, moderation, edit, close and expiry states.
38. Employer Applicant Management
Recruiters view applicants, filter them, change statuses, add notes and communicate according to permissions and candidate consent.
39. Employer Plans
Employer plans can control active jobs, postings, recruiter seats, applicant access, analytics, featured listings and credits.
40. Admin Console
The admin console is a complete operational control plane for users, employers, jobs, sources, billing, leads, fraud, queues, content, configuration and system health.
41. Admin Job and Source Operations
Admins can review, disable, reverify, merge, reindex, expire and trace jobs to sources while viewing source health.
42. Leads and Contact
The platform captures public leads through Contact Us and conversion forms, with UTM/source attribution, status, assignment and notes.
43. WhatsApp Integration
WhatsApp Business API may support approved notifications and support workflows with template/consent/opt-out governance.
44. Chatbot/AI Assistant
A platform assistant can help users search, understand jobs and navigate support while respecting authentication and entitlements.
45. Notification Platform
In-app, email and optional WhatsApp notifications must be template-based, preference-aware and auditable for important events.
46. Razorpay and Billing
Razorpay is the initial payment provider for student and employer plans, including signature-verified webhooks, reconciliation and payment history.
47. Global Payment Abstraction
Payments must use a provider interface so additional global providers can be added without changing subscription domain logic.
48. SEO Architecture
Public jobs and landing pages must be server-rendered/indexable, canonicalized, sitemap-driven and optimized for crawl efficiency and Core Web Vitals.
Job detail pages intended for indexing must render meaningful content server-side and have unique canonical URLs.
Generate XML sitemaps for canonical job URLs and use accurate modification timestamps; do not place internal search result pages in job-posting sitemaps.
Closed/expired jobs must be removed or updated promptly so search engines are not fed stale vacancies.
Faceted navigation must use canonical/noindex/crawl controls to prevent uncontrolled index bloat.
Use crawlable pagination and internal links for jobs; infinite scroll alone is insufficient for discovery.
Protect private/gated fields from indexation and page-source leakage.
Validate robots.txt, canonical tags, status codes, sitemap coverage and rendered HTML in CI/staging checks.
49. AEO/GEO and Structured Data
The platform must publish truthful machine-readable entities and job details suitable for search and AI answer systems, while following structured-data eligibility rules.
Use schema.org/JobPosting only on pages representing a single real open job and ensure structured data matches visible page content.
Include required/recommended properties only when facts are known; never create fake salary, hiring organization or dates.
Maintain accurate datePosted and validThrough where known, and remove structured data when a job is no longer open.
Use Organization, BreadcrumbList and other eligible structured data truthfully where applicable.
For remote jobs, populate remote-work structured fields only when source facts support them.
Run automated structured-data validation and periodic production sampling.
50. Internationalization
Text, currencies, dates, timezones, phone formats and locations must be locale-ready from the first release.
51. Privacy and Consent
Consent, data minimization, correction, export, deletion, retention and communication preferences are first-class product capabilities.
52. Security Architecture
Security must align with modern web application verification practices: strong authentication, authorization, validation, encryption, secrets management and monitoring.
Adopt OWASP ASVS 5.0 as a security verification reference baseline for authentication, authorization, input validation, session management, secrets and data protection.
Use secure HTTP-only same-site cookies or equivalent secure session design; rotate/revoke sessions after sensitive events.
Use strong password hashing when passwords are supported.
Encrypt sensitive secrets/tokens at rest and use managed secret storage.
Protect against XSS, CSRF, SSRF, injection, insecure redirects, file-upload attacks and authorization bypass.
Rate-limit authentication, search abuse, contact forms, employer posting and application actions.
Security test privileged endpoints and object-level authorization explicitly.
53. Abuse Prevention
Protect the platform from bot signups, employer spam, account takeover, application abuse, payment fraud and scraping of gated data.
54. Responsive Design and Accessibility
All key workflows must work on phones, tablets, laptops and desktops and target WCAG 2.2 AA-oriented practices.
Target WCAG 2.2 AA-oriented implementation across critical user journeys.
All interactive controls require keyboard operation, visible focus and programmatic labels.
Live job updates must not steal focus and must respect prefers-reduced-motion.
Use semantic headings, landmarks, form error associations and accessible status announcements.
Validate at common phone, tablet, laptop and large desktop breakpoints; no horizontal scrolling for primary workflows.
55. Next.js Application Architecture
Use Next.js App Router and TypeScript with clean server/client boundaries, domain modules and multi-instance safe deployment practices.
Use multi-instance safe configuration for shared cache/revalidation and consistent Server Action encryption when deploying multiple instances.
Put a reverse proxy/WAF/load balancer in front of self-hosted Next.js instances.
Use deployment/version skew protection for rolling releases.
Ensure personalized dynamic responses are private/no-store and never cached across users.
Prefer server rendering/static generation for public SEO pages while keeping authenticated dashboards dynamic.
56. MongoDB Architecture
MongoDB is the system of record. Schema, indexes, archival and sharding strategy must support progressive growth.
Production must use a highly available replica-set topology; scale vertically for early growth and shard when a single cluster can no longer meet throughput/data needs.
Use compound indexes based on real search/admin/application query patterns and monitor slow queries.
Avoid unbounded arrays/documents; move high-growth histories to dedicated collections.
Use archival/lifecycle strategy for raw discovery data and expired jobs.
Document candidate shard keys before sharding and benchmark them against workload traces.
Use separate analytics/read workloads where necessary so reporting cannot degrade transactional traffic.
57. Search and Vector Infrastructure
Search must support text, facets, geospatial filtering and semantic retrieval through an abstraction that can start with Atlas Search and evolve.
58. Queue and Worker Architecture
Long-running or bursty tasks belong in durable queues and independent worker pools rather than request/response handlers.
59. Real-Time Architecture
Live homepage updates, application progress and admin health can use SSE/WebSockets backed by scalable pub/sub.
60. Hyperscale Architecture (10–50 Lakh+ Users)
The architecture must tolerate growth from tens of thousands to 1–5+ million registered users without redesign. Capacity must scale horizontally for web/API, workers, search, cache and data tiers.
Design target: 1,000,000–5,000,000+ registered accounts with no architectural rewrite; registered users and concurrent users are separate capacity dimensions.
Web/API tier must remain stateless and horizontally scalable behind managed load balancing or equivalent.
Use autoscaling with minimum warm capacity; pre-scale for known campaigns because reactive autoscaling can lag sudden spikes.
Separate public search traffic, authenticated API traffic, admin traffic and background workers into independently scalable pools.
Adopt durable distributed caching/pub-sub (e.g., Redis-compatible) for shared cache, rate limiting, session auxiliaries, real-time fanout and Next.js multi-instance coordination where applicable.
MongoDB must have a documented scale path: replica-set production baseline, query/index tuning, vertical growth, then sharding when dataset/throughput demands it.
Shard-key design must avoid monotonically increasing hotspots and account for query targeting, cardinality and write distribution.
Search indexing must be asynchronous; a search outage must not corrupt the system of record.
Email/application queues must be partitionable and concurrency-controlled by provider/user/domain.
No request path should synchronously perform crawling, AI parsing, mass matching or application fanout.
Use connection pooling and enforce per-service connection budgets to protect MongoDB and third-party providers.
Define capacity tests at 100k, 500k, 1M, 2M and 5M registered-user data volumes plus realistic concurrent traffic.
Target progressive load scenarios such as 1k, 5k, 10k, 25k and 50k+ concurrent active sessions based on infrastructure sizing; validate rather than promise an untested number.
Use CDN caching for public assets/pages, cursor pagination for large result sets and asynchronous precomputation for expensive matching.
Implement graceful degradation: if AI matching is slow, basic search still works; if notifications fail, applications are not lost; if live feed fails, static refresh remains available.
Set service-level objectives for availability, API latency, queue lag, ingestion freshness and application-send reliability.
Run load, spike, soak and failure-injection tests before major scale milestones.
61. High Availability and Disaster Recovery
Critical services require redundancy, health checks, multi-zone deployment, backups, restoration drills and documented recovery objectives.
62. Caching and CDN Strategy
Public read traffic must be offloaded through CDN/edge caching where safe; personalized data must never be accidentally cached publicly.
63. Performance Engineering
Performance budgets, query plans, payload budgets, concurrency tests and load tests are mandatory before large campaigns or launches.
64. API Standards
APIs must be versioned, validated, paginated, rate-limited, idempotent where needed and return consistent error formats.
65. Analytics and Product Telemetry
Analytics must reveal funnels and system effectiveness while avoiding unnecessary personal-data capture.
66. Observability and Incident Response
Logs, metrics, traces, queue lag, provider health, dashboards, alerts and incident runbooks are mandatory for production.
67. Testing Strategy
Testing spans unit, integration, E2E, accessibility, security, payment, email, search relevance, worker resilience and load testing.
68. DevOps and Release Engineering
Use isolated dev/staging/production environments, CI/CD, migration gates, rollback, secrets separation and release checklists.
69. Data Retention and Backup
Every data class has retention, archival, backup and deletion rules, including OAuth tokens, raw job source data, CVs and audit logs.
70. Feature Flags and Configuration
High-risk features, providers, sources, plans, countries and ranking experiments must be controlled without code redeploys.
71. Design System
A reusable accessible component system ensures consistent cards, forms, tables, filters, dialogs, badges and state messaging.
72. Page-by-Page Functional Specification
Every public, student, employer and admin page must have defined purpose, actions, states, authorization and responsive behavior.
73. MongoDB Collection Catalogue
The implementation must maintain a documented catalogue of collections, ownership, indexes, lifecycle and sensitive fields.
74. API Endpoint Catalogue
The implementation must maintain a versioned endpoint inventory with method, path, actor, auth, input, output and rate policy.
75. Worker Catalogue
Every background worker must have trigger, concurrency, retry, idempotency, DLQ and monitoring definitions.
76. Permission Matrix
Permissions must be explicitly mapped across student, employer and admin roles.
77. Subscription Feature Matrix
Plan behavior must be visible in one matrix and enforced centrally by an entitlement service.
78. Acceptance Criteria Master Checklist
Release decisions use demonstrable acceptance criteria, not developer confidence alone.
79. Performance/Load Test Checklist
Scale readiness must be proven with workload models and repeatable tests.
80. Security/Privacy Checklist
Security and privacy controls are release gates, not post-launch enhancements.
81. SEO/AEO Checklist
Technical discoverability must be validated at launch and continuously monitored.
82. Launch Readiness Checklist
Launch requires product, engineering, operations, security, billing, support, backup and rollback readiness.
83. Phased Delivery Roadmap
Delivery should reduce risk through staged capability releases rather than attempting every integration simultaneously.
84. Codex Repository and Coding Rules
Code must be modular, typed, testable, provider-abstracted and documented enough that future Codex sessions can continue safely.
85. Risk Register
The project has legal/source-policy, privacy, fraud, provider-quota, scale, AI-inference, SEO and payment risks that require active controls.
86. Future Roadmap
Future capabilities may include native mobile apps, browser extension, ATS partnerships, interview scheduling, recruiter CRM and approved AI CV tailoring.
87. Reference Standards
The architecture and acceptance baseline references current official documentation from Google Search Central, Next.js, MongoDB, OWASP and W3C.
APPENDIX A. Page-by-Page Feature Inventory
The following inventory is a minimum baseline. Codex should create routes/components only after confirming authorization, data requirements, loading/error states and analytics for each page.
APPENDIX B. MongoDB Collection Catalogue
APPENDIX C. API Endpoint Catalogue — Initial Baseline
APPENDIX D. Background Worker Catalogue
APPENDIX E. Permission Matrix
APPENDIX F. Student Subscription Feature Matrix
Exact commercial values remain editable in Admin. The matrix defines the product shape, not final prices.
APPENDIX G. Hyperscale Capacity and Load-Test Matrix
Mandatory performance tests
Load test: sustained expected peak for at least 30–60 minutes.
Spike test: abrupt increase to several times normal traffic.
Soak test: multi-hour sustained load to detect leaks and queue drift.
Failover test: terminate web instance, worker, cache node/search node where architecture supports it and confirm graceful recovery.
Database pressure test: verify query/index behavior with production-like data volume.
Queue surge test: large ingestion burst plus candidate application backlog.
Provider throttling test: simulate Gmail/Microsoft/Razorpay limits and confirm backoff without data loss.
Cache failure test: core authenticated operations must remain correct even if slower.
Search degradation test: database truth remains intact and user gets fallback/degraded behavior.
Live-feed fanout test: verify real-time delivery does not overload database or web instances.
APPENDIX H. Master Launch Checklist
Product
☐ Public job search works
☐ Student onboarding works
☐ CV upload/parse/review works
☐ Preferences and related-role matching work
☐ Plan checkout and entitlement activation work
☐ Mailbox connect/disconnect works
☐ Email application is auditable
☐ External application states are accurate
☐ Employer posting/applicants work
☐ Admin controls are operational
Scale
☐ Multi-instance web deployment validated
☐ Shared cache/revalidation strategy validated
☐ Workers scale independently
☐ MongoDB indexes reviewed
☐ Search index replay tested
☐ Load/spike/soak tests passed
☐ Rate limits validated
☐ CDN caching validated
☐ Capacity alarms configured
Security
☐ Admin MFA enabled
☐ RBAC tests pass
☐ OAuth tokens encrypted/isolated
☐ File uploads scanned
☐ Secrets outside repo
☐ Rate limits active
☐ OWASP-oriented verification completed
☐ Audit logs present
☐ Backup restore tested
SEO/AEO
☐ Canonical tags correct
☐ JobPosting structured data valid where eligible
☐ Closed jobs handled
☐ Sitemaps partitioned and fresh
☐ Search result/faceted crawl rules set
☐ Robots validated
☐ Server-rendered content verified
☐ Structured data matches visible content
Operations
☐ Dashboards and alerts active
☐ Provider health visible
☐ Queue DLQs monitored
☐ Support process documented
☐ Fraud review queue staffed/owned
☐ Rollback runbook tested
☐ Incident severity model defined
APPENDIX I. Delivery Roadmap
APPENDIX J. Codex Repository Blueprint
Recommended logical structure (exact monorepo tooling can be selected during implementation):
apps/web — Next.js public/student/employer UI and BFF endpoints.
apps/admin — optional separated admin UI if operational isolation is desired.
workers/discovery — source scheduling/fetch.
workers/ingestion — parse/normalize/dedupe/verify/index.
workers/matching — match computation.
workers/applications — scheduling/sending.
workers/notifications — channel delivery.
packages/domain — entities, states, pure domain rules.
packages/schemas — shared validation contracts.
packages/db — MongoDB repositories/index definitions/migrations.
packages/search — SearchProvider abstraction.
packages/queue — QueueProvider abstraction.
packages/mail — MailProvider adapters.
packages/payments — PaymentProvider adapters.
packages/ai — model/provider abstraction and prompts/contracts.
packages/ui — design system.
packages/observability — logs/metrics/traces.
tests — integration/E2E/load fixtures.
docs — architecture decisions/runbooks/API catalogue.
APPENDIX K. Risk Register
APPENDIX L. Reference Standards and Official Guidance
The specification incorporates the following current official guidance as engineering references. Codex should re-check current provider documentation at implementation time because platform requirements can change.
FINAL MASTER DEFINITION OF DONE
The platform is deployable, secure, observable, documented and rollback-ready.
All requested student, employer, admin, discovery, matching, application, billing and communication workflows exist or are deliberately feature-flagged behind documented external dependencies.
The homepage provides the intended central job search and live new-job experience.
The system stores/searches the latest three months of jobs by default and preserves application history safely.
Candidates can control related roles, experience ranges, India/global locations and application preferences.
Basic/Pro/Premium plans and employer plans are centralized in entitlement configuration.
Email applications use candidate-authorized mailbox access and verified destinations; external ATS jobs are tracked accurately.
Fraud/verification controls prevent high-risk automatic CV delivery.
Next.js and MongoDB deployment paths are ready for multi-instance/horizontal scale.
Performance tests demonstrate capacity milestones; 1–5+ million registered-user scale does not require a platform rewrite.
SEO/AEO implementation follows current job structured-data and crawl-quality rules.
Critical workflows meet accessibility, privacy, security, test and audit gates.
No critical hidden TODO, hard-coded commercial rule or single-provider coupling remains in business logic.
APPENDIX M. Complete Requirement Traceability Matrix
This matrix maps the stated product requirements to concrete system behavior so Codex and QA can verify that no major requirement has been lost.
APPENDIX N. End-to-End Student Journey — Detailed Sequence
1. Visitor lands on Home and sees the job-search bar plus fresh live job cards.
2. Visitor searches using natural language or filters. Search parser converts intent to structured filters.
3. Visitor opens a job. Public fields render; gated employer/contact fields remain server-side protected.
4. Visitor clicks Apply Now. If not authenticated, Sign Up / Sign In is required.
5. New student verifies email and completes onboarding using CV upload or manual profile.
6. CV is scanned, parsed, normalized and shown for candidate confirmation. Unconfirmed inferred fields cannot be used as application facts.
7. Candidate selects target roles and acceptable related roles, skills, experience, locations, employment type and exclusions.
8. Candidate chooses Basic/Pro/Premium. Razorpay checkout activates entitlement only after verified payment event.
9. If email auto-application is needed, candidate connects a supported mailbox using OAuth and approves scopes.
10. Candidate chooses CV version and application template, previews rendered message, sets quotas and explicitly enables automation.
11. Matching engine scores recent verified jobs. autoApplyEligibility applies hard rules independently of relevanceScore.
12. Scheduler checks plan delay/priority, quotas, cooldown, duplicate history, job trust and destination verification.
13. For verified-email jobs, application snapshot is created and sender worker transmits through candidate mailbox; provider message ID is stored.
14. For external ATS jobs, candidate is sent to canonical website and platform records External Required / Started / Submitted accurately.
15. For employer-direct jobs, application enters employer applicant queue and recruiter status changes update the candidate timeline.
16. Candidate dashboard shows all states, plan usage and automation controls; candidate can pause future applications immediately.
17. Expired jobs disappear from normal search after retention/lifecycle rules, but historical application snapshots remain traceable.
APPENDIX O. End-to-End Employer Journey — Detailed Sequence
1. Employer selects Employer registration and creates organization profile.
2. Recruiter verifies business email and submits organization/domain evidence where required.
3. Trust engine assigns verification/risk status; review may be automated, manual or hybrid.
4. Employer chooses a subscription plan and completes verified payment.
5. Authorized recruiter creates a job using structured fields: title, function, skills, experience, location, salary, work mode, type, description and application path.
6. Validation checks completeness, suspicious content, company consistency and policy compliance.
7. Job enters draft/review/published state. Published job is indexed and becomes eligible for matching.
8. Candidate matches/applications are routed according to direct-platform or external/email method.
9. Recruiter views applicant list and may update status to Viewed, Shortlisted, Interview, Offer or Rejected.
10. Employer dashboard reports active jobs, applicants, usage and plan limits.
11. Employer can close or expire a job; closure propagates to search, matching, application scheduling and structured data.
12. Employer Admin manages team seats, roles, billing and organization settings.
APPENDIX P. Logical High-Scale Architecture Blueprint
The following logical design is intentionally provider-neutral and can be mapped to AWS, Azure, GCP, DigitalOcean or another suitable cloud after capacity and compliance review.
Scale design rules
Public website reads should hit CDN/cache whenever content can safely be shared.
Personalized responses must be private and never enter public cache.
Long-running work must be queued; web requests should enqueue and return quickly.
Worker concurrency must be controlled independently for AI, email, crawling and payment/webhook workloads.
Job ingestion spikes must not starve user search or application APIs.
Admin analytics must not perform unbounded scans against the primary transactional workload.
All dependencies require timeout, retry classification and circuit-breaker behavior.
Autoscaling policies must be tested and major marketing launches should be pre-scaled.
APPENDIX Q. Detailed Application State Machine
APPENDIX R. Admin Control Checklist
☐ Search and inspect users without exposing unnecessary secrets.
☐ See student plan, entitlement usage and payment history.
☐ See employer organization, verification, team and plan.
☐ Review and manage jobs, source provenance and duplicate merges.
☐ Enable/disable sources and edit permitted schedule/rate configuration.
☐ Review source health and parser failures.
☐ Review fraud queue, user reports and employer/job risk assessments.
☐ Configure Basic/Pro/Premium and employer plan features, limits and application delays.
☐ Configure job retention window and archival policy.
☐ Configure support email, phone and WhatsApp details shown on public pages.
☐ Manage lead assignments and contact-form statuses.
☐ View queue health, DLQs, worker errors and provider health.
☐ View payment webhook/reconciliation status.
☐ Manage feature flags and country/source rollout.
☐ Manage SEO page metadata/FAQ content and sitemap status.
☐ View audit trail for privileged changes.
☐ Trigger safe reindex/reverification/reprocessing operations.
☐ Emergency pause for auto-application and/or specific provider/source.
☐ Emergency disable of suspicious employer/job/domain.
APPENDIX S. Detailed Codex Build Checklist
Foundation
☐ Repository created
☐ TypeScript strict
☐ Environment validation
☐ Auth/RBAC
☐ MongoDB connection/index bootstrap
☐ Error model
☐ Logging/correlation IDs
☐ Feature flags
☐ Design system
☐ CI pipeline
Jobs
☐ Taxonomy seed/import
☐ Location model
☐ Source adapter interface
☐ At least one compliant source adapter
☐ Ingestion pipeline
☐ Dedupe
☐ Verification
☐ Fraud baseline
☐ Search index
☐ 90-day lifecycle
☐ Live feed
Student
☐ Onboarding
☐ CV upload/parse
☐ Profile
☐ Preferences
☐ Related-role selector
☐ Search/filter
☐ Matching
☐ Saved jobs
☐ Dashboard
Commercial
☐ Plan model
☐ Entitlement service
☐ Razorpay adapter
☐ Webhook idempotency
☐ Usage ledger
☐ Pricing pages
Applications
☐ Mailbox OAuth adapter
☐ Template editor/preview
☐ Eligibility engine
☐ Scheduler
☐ Email sender
☐ External flow
☐ Direct flow
☐ Application state machine
☐ Pause/cancel
☐ History
Employer
☐ Organization onboarding
☐ Verification
☐ Employer plan
☐ Job create/manage
☐ Applicant list
☐ Statuses
☐ Team/RBAC
☐ Billing
Admin
☐ Overview
☐ Users
☐ Employers
☐ Jobs
☐ Sources
☐ Fraud
☐ Plans
☐ Payments
☐ Leads
☐ Content/SEO
☐ Feature flags
☐ System health
Production
☐ Security review
☐ Accessibility test
☐ SEO structured-data test
☐ Load test
☐ Backup restore test
☐ Alerting
☐ Incident runbook
☐ Rollback test
☐ Launch checklist sign-off
