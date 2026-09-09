# Module 2 backend production hardening

## Production blocker resolution update

The Module 2-only worker command is now `npm run worker:module2` after building.
It uses the existing BullMQ architecture and CV processing/retention functions on
the dedicated `skillonit-cv` queue. It does not import or execute later-module
processors. The historical mixed `worker` command remains unchanged for compatibility;
do not run it for a Module 2-only deployment. Stop the previous mixed worker before
switching CV scheduling; MongoDB document leases protect concurrent processing, but
two schedulers should not be operated as the intended deployment.

An explicit ioredis production dependency is installed. BullMQ previously had no
Redis driver installed. Module 2 connections use environment configuration, a
default five-second connection timeout, at most three exponential reconnects,
and trusted `rediss://` in production. Optional controls are
REDIS_CONNECT_TIMEOUT_MS and REDIS_CONNECT_RETRIES. Workers retain the
BullMQ-required maxRetriesPerRequest=null; application startup and readiness waits
have separate deadlines. No certificate validation is disabled.

Stable scheduler IDs avoid duplicate schedule creation. CV jobs use three attempts
with exponential backoff; completed/failed queue history is bounded to 100/1000
records. MongoDB CV leases, attempts, revisions and failures remain authoritative.
Inactive/deleted/non-student owners now produce CV_OWNER_UNAVAILABLE instead of
repeatedly interrupting batches. Provider exceptions are replaced by fixed errors
before reaching BullMQ failedReason or worker-run records. Maintenance with failed
deletions is reported as a failed task and retried instead of reporting success.

Both SIGINT and SIGTERM stop the Module 2 worker gracefully. It waits up to 30 seconds
for active work, then releases connections/exits on failure; unfinished MongoDB
leases remain recoverable. Run under a service supervisor with bounded restart
backoff and alerts. Live Redis/worker startup, scheduler behavior, graceful drain,
Redis persistence/eviction policy and restart recovery still require deployment
validation. Local outage tests do not prove successful live worker operation.

`npm run module2:check` validates required production configuration without making
network requests or printing values. It names missing/invalid MongoDB, HTTPS origin,
OTP/email, CV storage/scanner/parser, Redis and limit configuration. Existing opaque
session architecture is reused; no new session secret or authentication mechanism
is invented. Production HTTP startup uses this same gate. The Module 2 worker also
requires it. Use `npm run module2:check -- --redis` for a Redis PING once configuration
passes. Use `npm run cv:check -- --live` for the documented non-personal provider
probe. Neither command certifies full production readiness.

Existing CV response fields remain compatible: uploading/queued represent upload;
processing with PENDING scan represents scanning; CLEAN records a successful scan;
extractionStatus=PARSING represents parsing; EXTRACTED with status=review represents
parsed/review_required. Confirmation remains explicit. Failed states retain fixed
error codes; successful deletion removes the document and leaves an ownership-bound
temporary deletion receipt. No renamed status breaks existing API clients.

Run Module 2-only checks with `npm run test:module2` and
`npm run test:module2:mongo`, followed by typecheck/build and dependency audit.
New regression coverage includes missing-config redaction, Redis TLS/options,
bounded outage/startup failure, task allowlisting, safe failure handling, and disabled
CV owners. Production services remain unconfigured and frontend E2E remains gated.

Worker design references: [BullMQ connections](https://docs.bullmq.io/guide/connections),
[retries](https://docs.bullmq.io/guide/retrying-failing-jobs), and
[graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown).

### Results for this blocker-resolution pass

- Module 2 unit/API/contract tests: 15 passed, 0 failed.
- Isolated architecture_test MongoDB replica-set suite: 1 passed, 0 failed.
- TypeScript and production compilation: PASS.
- Production dependency audit: 0 reported vulnerabilities.
- Git whitespace validation: PASS; frontend content diff: empty.
- Production configuration check: FAIL as expected with missing CV provider fields,
  ENABLE_CV_UPLOADS and REDIS_URL. No configuration values were printed.
- Compiled Module 2 worker startup: BLOCKED at the same configuration gate, exit 1.
  Successful live startup/shutdown and Redis connectivity were not verified.
- Private storage/scanner/parser live checks: BLOCKED by missing configuration.
- Frontend E2E: NOT STARTED because the backend production gate is incomplete.
- No .env changes, frontend edits, production data writes, commits or pushes.
- Verdict: MODULE 2 — NOT PRODUCTION READY.

Files changed in this pass:
backend/package.json; backend/package-lock.json; backend/.env.example;
backend/src/index.ts; backend/src/module2-production-check.ts;
backend/src/lib/module2-config.ts; backend/src/lib/module2-production-config.ts;
backend/src/lib/module2-redis.ts; backend/src/lib/cv-service.ts;
backend/src/workers/module2.ts; backend/src/workers/module2-runtime.ts;
backend/tests/module2-runtime.test.ts; backend/tests/module2-checks.ts; this document.

Missing services cannot be replaced by test doubles in production. Configure a private
bucket/workload identity, trusted HTTPS scanner/parser gateways and trusted TLS Redis
through the deployment's secret/configuration system, then rerun the live checks and
worker recovery tests before attempting frontend E2E. No credentials should be pasted
into the repository or conversation.

This report supplements the Enterprise Master Specification and the existing Module 2 documents. No frontend code, real credentials, production data, authentication mechanism or future-module execution was changed. Nothing was committed or pushed.

## Audit and gap map

Before this change: authentication, canonical profile confirmation, CV draft provenance, ATS preview/edit/version/TXT export, preferences, onboarding, consents, completion, catalog configuration, audit records and isolated database tests existed. Runtime CV adapters were unavailable; validation checked signatures only; lifecycle recovery, provider timeouts and operation-specific production configuration were missing.

Implemented: S3-compatible private storage adapter; HTTPS scanner/parser gateway adapters; bounded isolated document validation; scan/extraction metadata; duplicate-file reuse; capped retry API; protected download; deletion receipts; active CV version references; worker recovery and retention jobs; configurable limits; catalog IDs for preferences; skills catalog; catalog metadata; targeted hierarchy validation; profile provenance and field-level completion reasons; onboarding progression checks; idempotent preference retries. These additions preserve the existing candidate confirmation gate.

## CV providers and security

`cv-production.ts` implements `CvObjectStorage`, `CvScanner` and `CvParser`. Providers receive server-generated `cv/<user-id>/<document-id>` keys. Filenames never become storage paths. Storage keys and hashes stay out of CV API metadata. MongoDB stores references/metadata only, not uploaded binary contents.

The S3 adapter uses the AWS SDK credential chain (prefer workload IAM roles), HTTPS endpoints, request deadlines and AES256 server-side encryption. Startup verifies all four S3 Block Public Access flags and requires a non-versioned bucket. This deliberately fails closed on providers without those policy APIs or on versioned buckets: a version-aware deletion adapter would be required. No public ACL or permanent public URL is created. Download is authenticated, ownership checked, clean-scan gated and hash verified; it returns content as base64 in the usual JSON envelope. No signed URL is currently needed or issued. Configure least-privilege access restricted to the CV prefix and encryption/bucket-policy inspection.

Scanner gateway: trusted HTTPS POST, raw PDF/DOCX bytes, bearer credential from CV_SCANNER_TOKEN. Return exactly `{"status":"CLEAN"}` or `{"status":"INFECTED"}`. An unreachable service, malformed result or any other status fails closed. There is no production scan-skip mode.

Parser gateway: trusted HTTPS POST with raw bytes and CV_PARSER_TOKEN. Return `{"version":"<configured CV_PARSER_VERSION>","facts":{...partial profile fields...}}`. The gateway must parse PDF/DOCX in an isolated environment and return only source-supported facts. Neither redirects nor arbitrary callback URLs are accepted. Response size is bounded to 128 KiB. TLS verification remains enabled. Tokens, input bytes, extracted text and provider exception messages are not logged. Parser output remains advisory and cannot mark itself confirmed.

These are real adapter implementations but gateway services are external deployment requirements. Test doubles verify contracts; they are not evidence that a real scanner found a file clean or that a real parser extracted facts accurately.

Document validation checks filename, extension, claimed MIME, signature, configured size/format, then structural validity in a separate Node child process with a 128 MiB heap and ten-second deadline. PDF validation uses pdf-lib and rejects encrypted/invalid/zero-page or over-100-page documents. DOCX validation uses yauzl lazy entries and size checks, bounded entry count/expanded sizes, and XML validation with saxes. Traversal, duplicate entries, encrypted ZIP entries, embedded objects/macros, DTD/entities and external relationships are rejected. This conservative policy also rejects CVs with external DOCX hyperlinks. Structural validation is not a malware scanner; scanning remains mandatory before parsing/download.

## Lifecycle and APIs

Existing status values remain uploading → queued → processing → review → confirmed, with failed/deleting states. Additional scanStatus values are PENDING/CLEAN/INFECTED/FAILED; extractionStatus is PENDING/PARSING/EXTRACTED/FAILED. Metadata includes attempts, parserVersion, scan timestamp, retention deadline, revision and activeVersionId. Failures have fixed codes, including STORAGE_FAILED, SCANNER_FAILED, PARSER_FAILED, SCAN_REJECTED, STORAGE_DELETE_FAILED and RETRY_EXHAUSTED.

- `POST /api/v1/me/cv`: bounded raw upload; identical content for the same owner reuses existing metadata.
- `GET /api/v1/me/cv/:id/content`: ownership-checked clean CV download, JSON `{filename,contentType,base64}`.
- `POST /api/v1/me/cv/:id/retry`: `{expectedRevision}`; only eligible failed operations, capped attempts. Infected files cannot be retried into a clean state.
- Existing review/confirm/list/delete APIs remain. Confirmation creates immutable version content and sets an explicit active version. Extraction never writes canonical data.
- Deletion first makes a document unavailable, then deletes storage, then removes references/associated versions. External deletion failure remains observable and retryable. A minimal ownership-bound deletion receipt makes repeated deletion successful for 30 days; TTL removes receipts. Existing audit events remain without CV text.

BullMQ worker startup verifies storage and registers cv-process every minute and cv-maintenance hourly when uploads are enabled. Processing uses persisted leases; exhausted abandoned leases become failed. Maintenance recovers uploads stalled over an hour, retries deletion and removes expired documents in bounded batches. Retention cleanup can remove due files for disabled/deleted accounts; user-facing deletion still requires normal authorization. Redis/worker deployment and real retention/delete behavior must be validated before release. Versioned storage, legal holds and provider-specific backup retention are not implemented by this adapter.

## Profile, preferences, catalog and onboarding

Canonical profile writes use the existing field allowlist. Provenance now distinguishes manual/extracted sources and candidate-confirmed/unconfirmed status. No salary, experience, employer or education facts are inferred. Missing values remain unknown and completion reasons identify MISSING_OR_UNKNOWN versus CONFIRMATION_REQUIRED.

Preferences retain existing label fields and add occupationIds, locationIds and skillIds. Supplied IDs must exist and be active. In production, newly supplied legacy role/skill/geographic labels must also resolve to active catalog entries. Legacy labels already stored are not silently rewritten. Explicit identical preference updates are retry-safe; differing stale updates conflict. Salary, schedule and caps retain schema validation and caps respect configuration. Automation remains configuration only and requires independent automation consent. It never executes applications or connects mailboxes.

Catalog configuration adds skills and optional metadata `{version,source:"seed"|"managed"}`. Skills are exposed through authenticated `/api/v1/taxonomy/skills`. Imported seed examples are not production truth. Admin catalog changes use a transaction-level revision lock, unique slug checks, ancestor/direct-child indexed reads, related-role validation and active-parent integrity; no whole-collection scan is used for routine imports. Existing slugs cannot be reassigned. Existing occupation/location lookups remain paginated. Production startup requires managed, nonempty active occupation/location/skill catalogs and an explicit profile-completion policy.

Onboarding allows resuming/backtracking but rejects forward navigation across unmet required steps. Completion remains derived from persisted canonical/consent state and is idempotent. Separate consent types and revocation history are preserved. No mailbox OAuth or application execution was added.

## Configuration and indexes

Safe placeholders only were added to backend/.env.example. Configure secrets outside source control:

- ENABLE_CV_UPLOADS=true for production Module 2.
- CV_STORAGE_PROVIDER=s3; CV_S3_BUCKET; CV_S3_REGION; optional HTTPS CV_S3_ENDPOINT; AWS workload identity or standard SDK credential environment.
- CV_SCANNER_PROVIDER=https; CV_SCANNER_URL; CV_SCANNER_TOKEN.
- CV_PARSER_PROVIDER=https; CV_PARSER_URL; CV_PARSER_TOKEN; CV_PARSER_VERSION.
- CV_MAX_BYTES (default 5 MiB, ceiling 10 MiB), CV_ALLOWED_FORMATS (pdf/docx/pdf,docx), CV_PROVIDER_TIMEOUT_MS (default 15s, ceiling 60s), CV_MAX_ATTEMPTS (default 3), CV_RETENTION_DAYS (default 90).
- CV_UPLOADS_PER_MINUTE; MODULE2_MUTATIONS_PER_MINUTE; MODULE2_LOOKUPS_PER_MINUTE; MODULE2_ADMIN_PER_MINUTE; AUTOMATION_MAX_DAILY_CAP.
- Existing MongoDB and Redis configuration; managed catalog metadata and systemConfig/profile-completion policy.

New indexes: unique IDs for skills and cvDeletionReceipts; skills.slug unique; cvDocuments userId+sha256, status+updatedAt and expiresAt; deletion-receipt TTL. Existing authentication, ownership, catalog, version and lifecycle indexes remain. Uploaded-file retention uses application cleanup, not a MongoDB TTL that could orphan external objects. Existing canonical profile remains in users; no duplicate studentProfiles collection was introduced.

## Validation and release verdict

Automated validation covers real PDF and minimal DOCX structure, malformed files, unsafe DOCX relationships, size/signature/name validation, clean/infected/failed scanning, parser failure/retry, storage failure, deletion recovery, duplicate upload, ownership/download gating, immutable versions, canonical confirmation, preference ID validation/retries, safe provider errors/timeouts, S3 policy/encryption contracts and existing authentication regression. Adapter tests use explicitly identified test doubles. MongoDB integration uses only an isolated architecture_test replica set; production Skillonitemployment data is not modified. The frontend-dependent architecture suite is not rerun for this backend-only task.

IMPLEMENTED: backend adapters, lifecycle/security controls, configuration validation, persistence/index changes and automated checks.

CONFIGURATION REQUIRED: managed production catalogs, profile-completion/retention policy, private bucket/IAM and worker configuration.

EXTERNAL PROVIDER REQUIRED: live private storage, malware scanning gateway, factual extraction gateway, and Redis workers. No live provider end-to-end scan/parser/delete validation or operational load/restore test has been completed in this environment. Release must include a malicious-document corpus and provider-specific retention/backup validation. Automated tests are not an independent penetration test or proof of all deployment controls.

NOT PART OF MODULE 2: job discovery, matching execution, Auto-Apply, mailbox OAuth, payments or employer portal.

Final verdict: **NOT PRODUCTION READY** until the external services and deployment validations above pass. Code implementation and provider infrastructure readiness are separate; no live provider success is claimed.

Implementation references: [AWS S3 SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/), [yauzl validation and lazy entry processing](https://github.com/thejoshwolfe/yauzl), [pdf-lib load options](https://pdf-lib.js.org/docs/api/interfaces/loadoptions).

## Earlier hardening validation results (before blocker-resolution pass)

- npm test: 28 passed, 0 failed (including MongoDB-outage sanitization and provider/document failure paths).
- npm run test:mongo: PASS; isolated architecture_test replica set, including retention cleanup, ownership/uniqueness/index checks and authentication regression.
- npm run typecheck: PASS.
- npm run build: PASS.
- npm audit --omit=dev: 0 reported vulnerabilities; this is not a full security audit.
- git diff --check: PASS.
- Lint: no backend lint script configured.
- Frontend diff: no content changes; pre-existing worktree flags left untouched.
- .env: ignored and untracked; only .env.example placeholders changed.
- No commit/push. HEAD remains 0c03281.
- Presence-only inspection found no nonempty CV_S3_BUCKET, CV_S3_REGION, CV_SCANNER_URL/TOKEN or CV_PARSER_URL/TOKEN/VERSION in the local backend .env. Values were not printed and .env was not modified.

Live provider configuration and real end-to-end validation remain release blockers. Local running services were not restarted with incomplete production configuration.
