1. Executive Vision and Product Principles
2. Business Model and Success Metrics
2. Business Model and Success Metrics
3. Personas, Roles and Permission Model
3. Personas, Roles and Permission Model
4. Global Information Architecture
4. Global Information Architecture
5. Homepage and Live Job Stream
5. Homepage and Live Job Stream
6. Authentication and Identity
6. Authentication and Identity
7. Student Onboarding
7. Student Onboarding
8. Student Profile and CV Intelligence
8. Student Profile and CV Intelligence
9. Job Preferences and Matching Controls
9. Job Preferences and Matching Controls
10. Global Occupation Taxonomy
10. Global Occupation Taxonomy
11. Global Location Model
11. Global Location Model
12. Job Source Strategy
12. Job Source Strategy
13. Job Hunting/Discovery Engine
13. Job Hunting/Discovery Engine
14. Source Compliance and Governance
14. Source Compliance and Governance
15. Ingestion Pipeline
15. Ingestion Pipeline
16. Canonical Job Data Model
16. Canonical Job Data Model
17. Deduplication and Reposting
17. Deduplication and Reposting
18. 90-Day Retention and Lifecycle
18. 90-Day Retention and Lifecycle
19. Employer Verification
19. Employer Verification
20. Recruitment Email Verification
20. Recruitment Email Verification
21. Fraud and Scam Detection
21. Fraud and Scam Detection
22. Search Architecture
22. Search Architecture
23. Job Filters
23. Job Filters
24. AI Matching and Ranking
24. AI Matching and Ranking
25. Job Detail and Identity Gating
25. Job Detail and Identity Gating
26. Student Plans and Entitlements
26. Student Plans and Entitlements
27. Application Eligibility Rules
27. Application Eligibility Rules
28. Application Scheduling and Priority
28. Application Scheduling and Priority
29. Verified Email Application
29. Verified Email Application
30. Mailbox OAuth and Permissions
30. Mailbox OAuth and Permissions
31. Application Templates
31. Application Templates
32. External ATS/Application Links
32. External ATS/Application Links
33. Direct SkillOnIT Applications
33. Direct SkillOnIT Applications
34. Application Tracking
34. Application Tracking
35. Student Dashboard
35. Student Dashboard
36. Employer Registration and Verification
36. Employer Registration and Verification
37. Employer Job Posting
37. Employer Job Posting
38. Employer Applicant Management
38. Employer Applicant Management
39. Employer Plans
39. Employer Plans
40. Admin Console
40. Admin Console
41. Admin Job and Source Operations
41. Admin Job and Source Operations
42. Leads and Contact
42. Leads and Contact
43. WhatsApp Integration
43. WhatsApp Integration
44. Chatbot/AI Assistant
44. Chatbot/AI Assistant
45. Notification Platform
45. Notification Platform
46. Razorpay and Billing
46. Razorpay and Billing
47. Global Payment Abstraction
47. Global Payment Abstraction
48. SEO Architecture
48. SEO Architecture
49. AEO/GEO and Structured Data
49. AEO/GEO and Structured Data
50. Internationalization
50. Internationalization
51. Privacy and Consent
51. Privacy and Consent
52. Security Architecture
52. Security Architecture
53. Abuse Prevention
53. Abuse Prevention
54. Responsive Design and Accessibility
54. Responsive Design and Accessibility
55. Next.js Application Architecture
55. Next.js Application Architecture
56. MongoDB Architecture
56. MongoDB Architecture
57. Search and Vector Infrastructure
57. Search and Vector Infrastructure
58. Queue and Worker Architecture
58. Queue and Worker Architecture
59. Real-Time Architecture
59. Real-Time Architecture
60. Hyperscale Architecture (10–50 Lakh+ Users)
60. Hyperscale Architecture (10–50 Lakh+ Users)
61. High Availability and Disaster Recovery
61. High Availability and Disaster Recovery
62. Caching and CDN Strategy
62. Caching and CDN Strategy
63. Performance Engineering
63. Performance Engineering
64. API Standards
64. API Standards
65. Analytics and Product Telemetry
65. Analytics and Product Telemetry
66. Observability and Incident Response
66. Observability and Incident Response
67. Testing Strategy
67. Testing Strategy
68. DevOps and Release Engineering
68. DevOps and Release Engineering
69. Data Retention and Backup
69. Data Retention and Backup
70. Feature Flags and Configuration
70. Feature Flags and Configuration
71. Design System
71. Design System
72. Page-by-Page Functional Specification
72. Page-by-Page Functional Specification
73. MongoDB Collection Catalogue
73. MongoDB Collection Catalogue
74. API Endpoint Catalogue
74. API Endpoint Catalogue
75. Worker Catalogue
75. Worker Catalogue
76. Permission Matrix
76. Permission Matrix
77. Subscription Feature Matrix
77. Subscription Feature Matrix
78. Acceptance Criteria Master Checklist
78. Acceptance Criteria Master Checklist
79. Performance/Load Test Checklist
79. Performance/Load Test Checklist
80. Security/Privacy Checklist
80. Security/Privacy Checklist
81. SEO/AEO Checklist
81. SEO/AEO Checklist
82. Launch Readiness Checklist
82. Launch Readiness Checklist
83. Phased Delivery Roadmap
83. Phased Delivery Roadmap
84. Codex Repository and Coding Rules
84. Codex Repository and Coding Rules
85. Risk Register
85. Risk Register
86. Future Roadmap
86. Future Roadmap
87. Reference Standards
87. Reference Standards

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
49. AEO/GEO and Structured Data
The platform must publish truthful machine-readable entities and job details suitable for search and AI answer systems, while following structured-data eligibility rules.
50. Internationalization
Text, currencies, dates, timezones, phone formats and locations must be locale-ready from the first release.
51. Privacy and Consent
Consent, data minimization, correction, export, deletion, retention and communication preferences are first-class product capabilities.
52. Security Architecture
Security must align with modern web application verification practices: strong authentication, authorization, validation, encryption, secrets management and monitoring.
53. Abuse Prevention
Protect the platform from bot signups, employer spam, account takeover, application abuse, payment fraud and scraping of gated data.
54. Responsive Design and Accessibility
All key workflows must work on phones, tablets, laptops and desktops and target WCAG 2.2 AA-oriented practices.
55. Next.js Application Architecture
Use Next.js App Router and TypeScript with clean server/client boundaries, domain modules and multi-instance safe deployment practices.
56. MongoDB Architecture
MongoDB is the system of record. Schema, indexes, archival and sharding strategy must support progressive growth.
57. Search and Vector Infrastructure
Search must support text, facets, geospatial filtering and semantic retrieval through an abstraction that can start with Atlas Search and evolve.
58. Queue and Worker Architecture
Long-running or bursty tasks belong in durable queues and independent worker pools rather than request/response handlers.
59. Real-Time Architecture
Live homepage updates, application progress and admin health can use SSE/WebSockets backed by scalable pub/sub.
60. Hyperscale Architecture (10–50 Lakh+ Users)
The architecture must tolerate growth from tens of thousands to 1–5+ million registered users without redesign. Capacity must scale horizontally for web/API, workers, search, cache and data tiers.
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
1. Visitor lands on Home and sees the job-search bar plus fresh live job cards.
2. Visitor searches using natural language or filters. Search parser converts intent to structured filters.
2. Visitor searches using natural language or filters. Search parser converts intent to structured filters.
3. Visitor opens a job. Public fields render; gated employer/contact fields remain server-side protected.
3. Visitor opens a job. Public fields render; gated employer/contact fields remain server-side protected.
4. Visitor clicks Apply Now. If not authenticated, Sign Up / Sign In is required.
4. Visitor clicks Apply Now. If not authenticated, Sign Up / Sign In is required.
5. New student verifies email and completes onboarding using CV upload or manual profile.
5. New student verifies email and completes onboarding using CV upload or manual profile.
6. CV is scanned, parsed, normalized and shown for candidate confirmation. Unconfirmed inferred fields cannot be used as application facts.
6. CV is scanned, parsed, normalized and shown for candidate confirmation. Unconfirmed inferred fields cannot be used as application facts.
7. Candidate selects target roles and acceptable related roles, skills, experience, locations, employment type and exclusions.
7. Candidate selects target roles and acceptable related roles, skills, experience, locations, employment type and exclusions.
8. Candidate chooses Basic/Pro/Premium. Razorpay checkout activates entitlement only after verified payment event.
8. Candidate chooses Basic/Pro/Premium. Razorpay checkout activates entitlement only after verified payment event.
9. If email auto-application is needed, candidate connects a supported mailbox using OAuth and approves scopes.
9. If email auto-application is needed, candidate connects a supported mailbox using OAuth and approves scopes.
10. Candidate chooses CV version and application template, previews rendered message, sets quotas and explicitly enables automation.
10. Candidate chooses CV version and application template, previews rendered message, sets quotas and explicitly enables automation.
11. Matching engine scores recent verified jobs. autoApplyEligibility applies hard rules independently of relevanceScore.
11. Matching engine scores recent verified jobs. autoApplyEligibility applies hard rules independently of relevanceScore.
12. Scheduler checks plan delay/priority, quotas, cooldown, duplicate history, job trust and destination verification.
12. Scheduler checks plan delay/priority, quotas, cooldown, duplicate history, job trust and destination verification.
13. For verified-email jobs, application snapshot is created and sender worker transmits through candidate mailbox; provider message ID is stored.
13. For verified-email jobs, application snapshot is created and sender worker transmits through candidate mailbox; provider message ID is stored.
14. For external ATS jobs, candidate is sent to canonical website and platform records External Required / Started / Submitted accurately.
14. For external ATS jobs, candidate is sent to canonical website and platform records External Required / Started / Submitted accurately.
15. For employer-direct jobs, application enters employer applicant queue and recruiter status changes update the candidate timeline.
15. For employer-direct jobs, application enters employer applicant queue and recruiter status changes update the candidate timeline.
16. Candidate dashboard shows all states, plan usage and automation controls; candidate can pause future applications immediately.
16. Candidate dashboard shows all states, plan usage and automation controls; candidate can pause future applications immediately.
17. Expired jobs disappear from normal search after retention/lifecycle rules, but historical application snapshots remain traceable.
17. Expired jobs disappear from normal search after retention/lifecycle rules, but historical application snapshots remain traceable.

1. Employer selects Employer registration and creates organization profile.
2. Recruiter verifies business email and submits organization/domain evidence where required.
2. Recruiter verifies business email and submits organization/domain evidence where required.
3. Trust engine assigns verification/risk status; review may be automated, manual or hybrid.
3. Trust engine assigns verification/risk status; review may be automated, manual or hybrid.
4. Employer chooses a subscription plan and completes verified payment.
4. Employer chooses a subscription plan and completes verified payment.
5. Authorized recruiter creates a job using structured fields: title, function, skills, experience, location, salary, work mode, type, description and application path.
5. Authorized recruiter creates a job using structured fields: title, function, skills, experience, location, salary, work mode, type, description and application path.
6. Validation checks completeness, suspicious content, company consistency and policy compliance.
6. Validation checks completeness, suspicious content, company consistency and policy compliance.
7. Job enters draft/review/published state. Published job is indexed and becomes eligible for matching.
7. Job enters draft/review/published state. Published job is indexed and becomes eligible for matching.
8. Candidate matches/applications are routed according to direct-platform or external/email method.
8. Candidate matches/applications are routed according to direct-platform or external/email method.
9. Recruiter views applicant list and may update status to Viewed, Shortlisted, Interview, Offer or Rejected.
9. Recruiter views applicant list and may update status to Viewed, Shortlisted, Interview, Offer or Rejected.
10. Employer dashboard reports active jobs, applicants, usage and plan limits.
10. Employer dashboard reports active jobs, applicants, usage and plan limits.
11. Employer can close or expire a job; closure propagates to search, matching, application scheduling and structured data.
11. Employer can close or expire a job; closure propagates to search, matching, application scheduling and structured data.
12. Employer Admin manages team seats, roles, billing and organization settings.
12. Employer Admin manages team seats, roles, billing and organization settings.


TABLE 0
Field | Value
Document | SkillOnIT Automated Job Portal — Enterprise Master Specification
Version | 2.0
Status | Implementation Baseline
Date | 04 September 2026
Primary audience | Product, Engineering, Codex, QA, DevOps, Security, SEO, Operations
Core technologies | Next.js, TypeScript, MongoDB, search/vector provider, background queue, object storage, OAuth mail integrations
Commercial model | Student subscriptions + Employer subscriptions
Primary payment integration | Razorpay, behind PaymentProvider abstraction
Default job retention | Latest 90 days searchable, configurable
Scale target | 1–5+ million registered users; horizontally scalable concurrent workload

TABLE 1
Surface | Core purpose | Primary actors
Public Website | Job discovery, marketing, pricing, SEO/AEO, contact and trust pages | Visitors, search engines
Student Portal | Profile/CV, matching, subscriptions, mailbox connection, applications and tracking | Job seekers
Employer Portal | Organization verification, job posting, applicant management and billing | Employers/recruiters
Admin Console | Users, employers, jobs, sources, payments, fraud, content, leads, queues and configuration | Operations/admin teams
Discovery Platform | Continuously ingest, normalize, deduplicate, verify and index jobs | System workers
Automation Platform | Match, schedule, send, track and notify applications | System workers + candidates

TABLE 2
Page | Actor | Minimum capabilities
Home / Jobs | Public | Search bar, live jobs, categories, trust proof, pricing CTA, employer CTA, sign-in/up
Search Results | Public/Student | Query, filters, sort, cards, pagination, saved search, match explanations
Job Detail | Public/Student | Full allowed job facts, match, source, trust, CTA, gating, report
About | Public | Mission, product explanation, contact CTA
Student Pricing | Public | Basic/Pro/Premium, entitlements, FAQs, checkout CTA
Employer Pricing | Public | Employer plans, job/applicant limits, CTA
Safety & Trust | Public | Verification, fraud reporting, safe-job-search guidance
Contact | Public | Lead form, configured email, phone, optional WhatsApp
Student Sign Up | Public | Identity, role, verification
Student Onboarding | Student | CV/profile, preferences, plan, mailbox, automation consent
Student Dashboard | Student | Metrics, recommendations, queue, usage, automation status
My Profile | Student | Canonical candidate details, completeness, edit
My CVs | Student | Upload, parse, versions, target mapping, delete
Job Preferences | Student | Roles, skills, experience, countries/states/cities, exclusions
Saved Jobs | Student | Saved list, filters, apply actions
Applications | Student | Application table/timeline and statuses
Email Integration | Student | Connect/disconnect, scopes, health, sender settings
Automation Settings | Student | Mode, caps, delays, roles, exclusions, pause
Billing | Student | Plan, usage, payments, invoices/receipts metadata
Employer Sign Up | Employer | Organization + recruiter identity
Employer Verification | Employer | Domain/evidence/status
Employer Dashboard | Employer | Jobs, applicants, plan and analytics
Create Job | Employer | Structured job form, preview and publish
Manage Jobs | Employer | Draft/live/closed, edit, close, metrics
Applicant List | Employer | Filters, statuses, CV access, notes
Employer Team | Employer Admin | Invite/remove, roles, permissions
Employer Billing | Employer Admin | Plan, usage and payments
Admin Overview | Admin | KPIs, incidents, queues, fraud and revenue
Admin Users | Admin | Search, account state, subscriptions, privacy actions
Admin Employers | Admin | Verification, team, jobs, risk
Admin Jobs | Admin | Review, disable, merge, reindex, expire
Admin Sources | Admin | Source health, compliance, parser, schedule, failures
Admin Applications | Admin | Operational status, failures, safe diagnostics
Admin Fraud | Trust | Flags, reports, evidence, actions
Admin Plans | Finance/Admin | Prices, limits, delays, entitlements
Admin Payments | Finance | Transactions, webhooks, reconciliation
Admin Leads | Admin | Contact leads, assignment, notes
Admin Content/SEO | SEO Admin | Pages, metadata, FAQs, landing-page rules
Admin Feature Flags | Super Admin | Provider/source/plan/country/risk feature controls
Admin System Health | Operations | Queues, providers, database/search health, alerts

TABLE 3
Collection | Purpose | Important indexes/notes
users | Identity, roles, status, contact verification | email unique; role/status indexes
sessions | Session/device metadata | userId, expiresAt TTL
studentProfiles | Canonical candidate profile | userId unique; target role fields
studentPreferences | Search/automation preferences | userId unique
cvDocuments | Original CV file metadata | userId, status
cvVersions | Parsed/curated CV variants | userId, roleFamilyIds
skills | Canonical skill taxonomy | slug unique; aliases
occupationFamilies | Occupation taxonomy | slug,parentId
locations | Global hierarchy | countryCode,parentId,geo
employers | Organization master | domain,status,trustScore
employerMembers | Organization membership | employerId,userId
employerVerifications | Evidence/review | employerId,status,reviewedAt
jobs | Canonical vacancies | status,discoveredAt,role,location,employerId
jobSources | Source adapter configuration | enabled,health,status
jobSourceVariants | Source-specific representations | sourceId,sourceJobId unique
jobIngestionEvents | Pipeline trace | job/source/stage/timestamp
jobRiskAssessments | Fraud/verification outcomes | jobId,riskLevel
savedJobs | Candidate bookmarks | userId,jobId unique
savedSearches | Queries/alerts | userId,enabled
jobMatches | Precomputed match outputs | userId,jobId,modelVersion
applications | Canonical application record | userId,jobId,status
applicationEvents | Status timeline | applicationId,createdAt
applicationSnapshots | Immutable CV/template/job snapshot | applicationId unique
mailConnections | OAuth connection metadata | userId,provider,status
mailTokens | Encrypted token material or secret reference | connectionId; isolated access
applicationTemplates | Subject/body/signature versions | userId,roleFamilyId
plans | Student/employer plan definitions | audience,code unique
subscriptions | Active/previous subscription | userId/employerId,status
entitlementUsage | Quota ledger | ownerId,period,entitlement
payments | Provider payment record | providerPaymentId unique
paymentEvents | Webhook events | providerEventId unique
leads | Contact/marketing leads | status,source,assignedTo
notifications | In-app notification records | userId,status,createdAt
notificationPreferences | Channel preferences | userId
fraudReports | User/admin reports | entityType,entityId,status
auditLogs | Immutable audit events | actorId,action,createdAt
featureFlags | Feature controls | key unique
systemConfig | Configuration values | key unique
workerRuns | Worker execution summaries | worker,status,createdAt

TABLE 4
Method | Endpoint | Actor | Purpose
POST | /api/v1/auth/register | Public | Create account
POST | /api/v1/auth/login | Public | Authenticate
POST | /api/v1/auth/verify-email | User | Verify email
GET | /api/v1/jobs | Public/User | Search/filter jobs
GET | /api/v1/jobs/:id | Public/User | Job detail with gating
POST | /api/v1/jobs/:id/save | Student | Save job
GET | /api/v1/me/profile | Student | Read profile
PUT | /api/v1/me/profile | Student | Update profile
POST | /api/v1/me/cv | Student | Upload CV
GET | /api/v1/me/preferences | Student | Read preferences
PUT | /api/v1/me/preferences | Student | Update preferences
GET | /api/v1/me/matches | Student | Ranked matches
POST | /api/v1/applications | Student | Create manual/application request
GET | /api/v1/applications | Student | Application history
POST | /api/v1/applications/:id/cancel | Student | Cancel queued application
POST | /api/v1/mail/connect | Student | Begin OAuth
POST | /api/v1/mail/disconnect | Student | Revoke/disconnect
GET | /api/v1/mail/status | Student | Connection health
GET | /api/v1/plans | Public | Pricing/entitlements
POST | /api/v1/billing/checkout | User/Employer | Create checkout
POST | /api/v1/webhooks/razorpay | Provider | Signature-verified webhook
POST | /api/v1/employers | Employer | Create organization
POST | /api/v1/employers/:id/jobs | Employer | Create job
GET | /api/v1/employers/:id/jobs | Employer | Manage jobs
GET | /api/v1/employers/:id/applicants | Employer | Applicants
PATCH | /api/v1/employers/:id/applications/:applicationId | Employer | Update candidate status
POST | /api/v1/contact | Public | Create lead/contact request
POST | /api/v1/reports | User | Report job/employer
GET | /api/v1/admin/overview | Admin | Operational KPIs
GET | /api/v1/admin/jobs | Admin | Job operations
PATCH | /api/v1/admin/jobs/:id | Admin | Moderation/metadata action
GET | /api/v1/admin/sources | Admin | Source health
PATCH | /api/v1/admin/sources/:id | Admin | Source configuration
GET | /api/v1/admin/fraud | Trust | Fraud queue

TABLE 5
Worker | Trigger | Responsibility | Reliability notes
source-discovery | Scheduled per source | Discover candidate job URLs/records | Backoff + circuit breaker
source-fetch | Discovery queue | Fetch permitted source content | Retry transient failures
job-parse | Fetched payload | Extract structured job data | Quarantine parser anomalies
job-normalize | Parsed job | Normalize taxonomy/location/salary | Deterministic/idempotent
job-dedupe | Normalized job | Merge duplicates/reposts | Semantic + fingerprint
job-verify | Canonical job | Employer/email/risk verification | Blocks high-risk automation
job-index | Published/updated job | Update search index | Async; replayable
job-match | Job/profile change | Calculate relevance/eligibility | Batch/partitioned
auto-apply-scheduler | Eligible match + plan | Create application queue item | Quota + delay + duplicate rules
application-sender | Application queue | Send verified email or direct application | Provider/domain concurrency
mail-retry | Failed send | Retry transient mail errors | Bounded attempts + DLQ
notification-dispatch | Domain events | Email/in-app/WhatsApp | Preference aware
job-revalidation | Schedule | Check jobs still open | Source-policy aware
job-retention | Daily | Archive/expire > retention window | Preserve application snapshot
billing-webhook | Provider webhook | Apply payment/subscription state | Idempotent event ID
fraud-recheck | Risk trigger/schedule | Re-evaluate job/employer | Versioned rules
analytics-rollup | Schedule | Aggregate product/system metrics | Read-optimized
search-sitemap | Schedule/job changes | Generate sitemap partitions | Accurate lastmod

TABLE 6
Capability | Visitor | Student | Employer | Admin
Search public jobs | Yes | Yes | Yes | Yes
View gated employer identity | No | By plan | Own jobs | Admin policy
Upload CV | No | Yes | No | Support-safe only
Enable auto-apply | No | Yes | No | No
Post job | No | No | Yes | Yes
View applicants | No | No | Own org/plan | Yes
Change applicant status | No | No | Own org | Yes
Manage plans | No | No | No | Finance/Super
Verify employers | No | No | No | Trust/Admin
Configure job sources | No | No | No | Operations/Super
View audit logs | No | Own privacy history | Own org subset | Authorized admin

TABLE 7
Feature | Basic | Pro | Premium
Search/browse jobs | Included | Included | Included
Profile/CV matching | Standard | Advanced | Advanced + priority
Company/contact visibility | Configurable limited | Expanded | Expanded
Daily applications | Configurable low cap | Higher cap | Highest safe cap
Application timing | Delayed | Faster | Immediate/near-immediate after verification
Auto-apply | Limited/optional | Yes | Yes + priority
Multiple CV variants | Limited | More | More
Saved searches/alerts | Basic | Advanced | Advanced
Support | Standard | Priority | Priority/Premium
Analytics/history | Basic | Expanded | Expanded

TABLE 8
Stage | Dataset size | Concurrent test target | Workload | Purpose
S1 | 100k registered | 1k concurrent | Search + auth + dashboard | Baseline production
S2 | 500k registered | 5k concurrent | Search + live feed + applications | Scale validation
S3 | 1M registered | 10k concurrent | Peak campaign + worker load | First million milestone
S4 | 2M registered | 25k concurrent | Multi-pool autoscaling + search pressure | Large-scale milestone
S5 | 5M registered | 50k+ concurrent target test | Peak spike/soak/failure tests | Hyperscale validation; final target must be proven with actual infra sizing

TABLE 9
Phase | Scope | Exit condition
0 — Foundation | Repository, auth, RBAC, configuration, design system, environments, observability, MongoDB baseline | Secure skeleton deploys to staging
1 — Public Jobs | Taxonomy, sources MVP, ingestion, search, homepage live feed, job details, SEO baseline | Users can discover recent jobs reliably
2 — Student Intelligence | CV/profile, preferences, matching, saved jobs, dashboard | Relevant personalized jobs available
3 — Billing + Applications | Plans, Razorpay, OAuth mail, templates, email apply, external tracking | Paid candidate application workflow works end-to-end
4 — Employer Platform | Employer verification, job posting, applicants, employer plans | Employer direct recruitment operational
5 — Trust + Scale | Fraud, source governance, queue hardening, performance work, 1M-scale tests | Large production traffic validated
6 — Global Expansion | More countries/sources/providers/languages/payments | International operations repeatable

TABLE 10
Risk | Impact | Primary mitigation
Job-source terms / scraping restrictions | High | Source governance, permitted adapters, legal review, APIs/feeds first
Fraudulent jobs | High | Risk scoring, destination verification, reports, moderator queue
Mailbox spam/provider suspension | High | User consent, quotas, domain cooldowns, provider policies, gradual ramp
OAuth token exposure | Critical | Encryption, secret isolation, least scopes, rotation/revocation
Scale spike | High | Autoscaling, pre-scaling, CDN/cache, queue buffering, load tests
MongoDB hotspot | High | Indexes, workload review, sharding plan, shard-key validation
Search index outage | Medium | System of record isolation, replayable indexing, degraded search
Payment webhook duplication | Medium | Signature verification + idempotent provider event IDs
AI false inference | High | Provenance, candidate confirmation, no fabricated application facts
SEO stale jobs | High | Revalidation, expiry pipeline, sitemap accuracy, structured-data removal
International privacy | High | Jurisdiction review, consent/data rights, configurable retention/providers

TABLE 11
Reference | How it informs this project | Official URL
Google Search Central — JobPosting structured data | Job detail structured data must describe a single real job, match visible content, use accurate dates and keep job sitemaps current. | https://developers.google.com/search/docs/appearance/structured-data/job-posting
Google Search Central — Crawling/Indexing and JavaScript SEO | Server-render meaningful content, maintain crawl controls/canonicals/sitemaps and ensure lazy/dynamic content remains discoverable. | https://developers.google.com/search/docs/crawling-indexing
Next.js — Self-hosting / multi-instance | Reverse proxy, shared/multi-instance cache coordination, consistent server-action keys and deployment version coordination are relevant to scaled self-hosting. | https://nextjs.org/docs/app/guides/self-hosting
MongoDB Atlas — Sharding and Scalability | Horizontal scaling via sharding distributes data/workload; shard selection and proactive capacity planning are important for large workloads. | https://www.mongodb.com/docs/atlas/cluster-sharding/
OWASP ASVS 5.0 | Security verification baseline for web application controls. | https://owasp.org/www-project-application-security-verification-standard/
W3C WCAG 2.2 | Accessibility recommendations for web content across devices and disabilities. | https://www.w3.org/TR/wcag/

TABLE 12
ID | Requirement | Implementation behavior | Primary module | Priority
R-001 | Worldwide platform | Jobs, taxonomies, locations and architecture support multiple countries and currencies | Internationalization + Global Location Model | Mandatory
R-002 | All device support | Desktop, laptop, tablet and mobile responsive layouts | Responsive Design | Mandatory
R-003 | ChatGPT-style home | Central natural-language search with simple first-screen job intent | Homepage | Mandatory
R-004 | Continuous new-job popup/feed | SSE/WebSocket live feed with pause/reduced-motion | Real-Time + Homepage | Mandatory
R-005 | Three months of jobs | Default 90-day searchable retention with configurable lifecycle | Retention Worker | Mandatory
R-006 | All job domains | Extensible worldwide occupation taxonomy, not IT-only | Taxonomy | Mandatory
R-007 | Related-role matching | User selects accepted related role families/title aliases | Preferences + Matching | Mandatory
R-008 | Experience matching | Fresher and configurable year bands/exact ranges | Filters + Matching | Mandatory
R-009 | India / outside India | Country, India state/UT and city filters plus global choices | Locations + Filters | Mandatory
R-010 | Top/MNC jobs | Curated employer metadata supports MNC/top-company filters | Employer Metadata | Required
R-011 | Email application | Verified destination + candidate OAuth mailbox + CV/template | Application Engine | Mandatory
R-012 | Website/ATS application | Canonical link and accurate external-progress tracking | External Apply | Mandatory
R-013 | Hide company/email | Entitlement-aware gating without API/HTML leakage | Job Detail + Entitlements | Mandatory
R-014 | Apply Now subscription gate | CTA checks auth, profile, plan and application capability | Entitlement Service | Mandatory
R-015 | Basic / Pro / Premium | Configurable plans and feature/limit matrix | Plans | Mandatory
R-016 | Different apply timing | Plan-controlled delay/priority; Premium may be near-immediate | Scheduler | Mandatory
R-017 | Different daily apply counts | Central quota ledger and per-period caps | Entitlements | Mandatory
R-018 | CV upload or manual profile | Two onboarding paths converging to canonical candidate profile | Onboarding | Mandatory
R-019 | CV extraction | Parse skills, experience, education, projects, contact, roles, etc. | CV Intelligence | Mandatory
R-020 | Email subject/message format | Versioned subject/body/signature templates with preview | Templates | Mandatory
R-021 | Application history | Student timeline, filters and immutable application snapshots | Application Tracking | Mandatory
R-022 | Employer portal | Organization onboarding, posting, applicants, teams, billing | Employer Portal | Mandatory
R-023 | Employer subscriptions | Configurable employer plan entitlements | Employer Plans | Mandatory
R-024 | Job hunting everywhere | Source adapter portfolio: APIs, feeds, ATS, permitted sites, partners and employer direct | Discovery Engine | Mandatory with source-policy limits
R-025 | Company verification | Domain/source/evidence/behavior-based verification | Trust Platform | Mandatory
R-026 | Fraud email protection | Recruitment email/domain and job risk scoring before auto-send | Fraud Detection | Mandatory
R-027 | Admin panel | Users, portfolios, plans, payments, jobs, sources, fraud, leads, system health | Admin Console | Mandatory
R-028 | Leads/contact form | Contact lead storage, attribution, assignment and notes | Leads | Mandatory
R-029 | Phone/email contact | Configurable business contact information on public pages | Content Config | Mandatory
R-030 | WhatsApp integration | Approved WhatsApp Business API integration with consent | Notifications/Support | Required
R-031 | Email integration | OAuth provider adapters and notification email | Mail Platform | Mandatory
R-032 | Chatbot | Search/support assistant with auth and entitlement boundaries | AI Assistant | Required
R-033 | Razorpay | Signature-verified checkout/webhooks/reconciliation | Payments | Mandatory India baseline
R-034 | MongoDB | MongoDB system of record with indexes, lifecycle and sharding path | Data Architecture | Mandatory
R-035 | Next.js | Next.js + TypeScript application with SSR/indexability and multi-instance readiness | Web Architecture | Mandatory
R-036 | SEO/AEO | Canonical public pages, JobPosting data, sitemaps, crawl controls, answer-friendly content | SEO/AEO | Mandatory
R-037 | Editable/future features | Feature flags, system config, admin-managed plans/taxonomy/settings | Configuration | Mandatory
R-038 | 10–50 lakh+ users | Horizontal scaling; load tests at progressive data/concurrency stages | Hyperscale Architecture | Mandatory
R-039 | Traffic spike resilience | Autoscaling, CDN, cache, queue buffering, graceful degradation and pre-scaling | Performance/HA | Mandatory

TABLE 13
Layer | Components | Scale behavior
Edge | DNS, CDN, WAF, DDoS protection, TLS, rate limiting | Global caching and traffic filtering before origin
Load Balancing | Managed LB / ingress / reverse proxy | Distributes requests across healthy web/API instances
Web/API | Stateless Next.js instances or containers | Horizontal autoscaling; separate public/auth/admin pools if needed
Real-time | SSE/WebSocket gateways + pub/sub | Horizontal fanout; no database polling per connected client
Cache | Distributed Redis-compatible service | Shared cache, rate limits, pub/sub, coordination; replicated/highly available
System of Record | MongoDB production cluster | Replica-set HA; autoscale/vertical growth; sharding for horizontal scale
Search | Atlas Search or independent SearchProvider | Asynchronous index; faceting, text, geo, vector; replay from database
Queue | Durable queue/event bus | Buffers discovery/application bursts; worker isolation and DLQ
Workers | Discovery, ingestion, verification, matching, application, notifications | Independent autoscaling by queue depth and provider limits
Object Storage | CVs, safe raw artifacts, exports | Private buckets, encryption, signed URLs, lifecycle policies
Providers | Mail, Razorpay, WhatsApp, AI/model providers | Adapters, circuit breakers, retry/backoff and quotas
Observability | Logs, metrics, traces, alerting | Centralized dashboards and incident signals
Backup/DR | Database backups, config/secrets recovery, runbooks | Restore tests and documented RPO/RTO

TABLE 14
State | Meaning | Possible next states
RECOMMENDED | Matched to candidate, no action yet | SAVED, QUEUED, EXTERNAL_REQUIRED, DIRECT_SUBMITTED, DISMISSED
SAVED | Candidate bookmarked job | QUEUED, EXTERNAL_REQUIRED, DIRECT_SUBMITTED, WITHDRAWN
QUEUED | Eligible application scheduled | NEEDS_REVIEW, SENDING, CANCELLED, FAILED
NEEDS_REVIEW | Candidate input/approval required | QUEUED, CANCELLED
SENDING | Provider send in progress | SENT, FAILED
SENT | Email provider accepted/sent | REPLIED, INTERVIEW, REJECTED, UNKNOWN
EXTERNAL_REQUIRED | Employer/ATS form required | EXTERNAL_STARTED, EXTERNAL_SUBMITTED, CLOSED
EXTERNAL_STARTED | Candidate opened/started flow | EXTERNAL_SUBMITTED, WITHDRAWN, CLOSED
EXTERNAL_SUBMITTED | Candidate/integration confirms external submission | VIEWED, INTERVIEW, OFFER, REJECTED, UNKNOWN
DIRECT_SUBMITTED | Platform-native employer application | VIEWED, SHORTLISTED, INTERVIEW, OFFER, REJECTED, WITHDRAWN
FAILED | Delivery/processing failed | QUEUED if retryable, CANCELLED if terminal
VIEWED | Employer viewed application | SHORTLISTED, INTERVIEW, OFFER, REJECTED
SHORTLISTED | Employer shortlisted | INTERVIEW, OFFER, REJECTED
INTERVIEW | Interview stage | OFFER, REJECTED, WITHDRAWN
OFFER | Offer reported | ACCEPTED, DECLINED, WITHDRAWN
REJECTED | Rejected/closed by employer | Terminal
WITHDRAWN | Candidate withdrew | Terminal
CLOSED | Job closed before completion | Terminal
UNKNOWN | Outcome not known | Any externally reported terminal/progress state