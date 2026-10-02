# Production migration audit — 2026-09-29

Read-only initial investigation. No Atlas, DNS, service, credential or production data changes were made during this audit. Existing migration code was inspected, not rerun.

## Writer evidence

- New AWS host 13.204.245.237 runs API `node dist/index.js` and Next.js. The API process has DATABASE_URL and no MONGODB_URI. No discovery, semantic, CV or general queue worker was found in its process/service inventory. No application cron/timer was found in the inspected user/root cron and systemd inventories.
- `backend/scripts/start-with-discovery.mjs` normally starts API, `job-engine/cli.js watch`, and `job-engine/cli.js watch-semantic`. The AWS API service bypasses this launcher.
- `backend/src/job-engine/cli.ts:12` rejects startup without MONGODB_URI even though the shared repository supports PostgreSQL. Its discovery heartbeat writes `jobEngineState/discovery-heartbeat` every 30 seconds. Required discovery writes in `job-engine/engine.ts` include jobs, jobFeedVariants, jobFeedFingerprints, jobFeedStates, jobFeedRuns, jobFeedSources and jobEngineState. `job-engine/semantic.ts` writes jobVectors. These are required business functions, not migration-only writes.
- `backend/src/matching-index.ts:10` also requires MONGODB_URI. It uses the shared store and manages matching-index state/leases and an external search index.
- `backend/src/lib/store.ts` implements direct Mongo replacement, bulk replacement, deletion and index creation. `read`, `transaction` and `bootstrapIndexes` select PostgreSQL first when DATABASE_URL is present. Workers and API callers can still select Mongo when configured only with MONGODB_URI.
- Migration script reads Mongo and writes PostgreSQL. `db-check.ts` is a connectivity reader. Test Mongo databases are distinct from an identified production writer.
- Atlas read succeeded from the local machine without altering access rules. At inspection, its discovery heartbeat was 2026-09-29T08:50:32.266Z versus PostgreSQL 2026-09-29T06:46:43.023Z. This confirms continued heartbeat writes. It does not identify the writer's host or PID.
- No matching application Node process was found in the inspected local Windows process inventory. Atlas currentOp inspection returned AtlasError. Read-only SSH inventory attempts to existing DNS addresses 65.2.25.240 and 13.202.237.22 were blocked by a timeout and host-key verification respectively; these hosts were not changed. Their role in the writing is unproven.
- Exact external host/PID remains UNRESOLVED. Do not label the writer migrated or stop an unidentified service.

## CV and other configuration

- Live NODE_ENV=development; DEMO_MODE=false.
- Live production configuration validation reports missing CV_PARSER_PROVIDER, CV_PARSER_URL, CV_PARSER_TOKEN, CV_PARSER_VERSION and ENABLE_CV_UPLOADS.
- Supported implementation is `backend/src/lib/cv-production.ts`: private Google Drive storage, Cloudmersive scanner, and HTTPS parser accepting document bytes with bearer authorization and returning `{version, facts}` matching the profile schema. Provider values cannot be invented.
- Google Drive credential fields and Cloudmersive URL/token are present; provider connectivity and real-document accuracy have NOT been validated by this audit.
- CV processing worker is not running on the inspected AWS host. Redis URL presence is not proof that Redis is reachable or that a worker is processing tasks.
- Startup additionally requires managed catalog/profile policies and active occupationFamilies, locations and skills. Those catalog collections contain no records in the inspected PostgreSQL database. Providing a parser alone is therefore insufficient to declare production startup ready.
- Razorpay key ID, key secret and webhook secret are absent. Real checkout/webhook/subscription verification is BLOCKED.
- GOOGLE_CALLBACK_URL is https://employment.skillonit.com/api/auth/google/callback. `backend/src/google-auth.ts` requires /api/v1/auth/google/callback. Live GET /api/v1/auth/google/status returned `{data:{available:false}}`. Provider console redirect registration was not inspected.
- SMTP/auth-email and Google credential fields are present, without disclosure of their values. Login, OTP delivery, reset, Google consent/callback, CV processing, payments and authenticated admin flows have NOT passed end-to-end verification.

## Data verification limits

- Prior migration reported 92 collections and 179,224 equal counts. That is a historical count check, not proof of equal contents.
- Current sampled source/target counts agree for users (11), jobs (38,722), applications (6), employers (0), profiles (0), cvDocuments (0), payments (0). Other empty target collections include studentSubscriptions, billingRecords and cvVersions. Empty collections do not establish working workflows.
- Six PostgreSQL applications have valid userId and jobId references (zero orphans under these two checks).
- PostgreSQL table relpersistence=p confirms logged storage.
- Existing migration script skips collections on estimated count equality and otherwise inserts only missing IDs. It does not reconcile updates/deletions of existing IDs. The heartbeat discrepancy is confirmed evidence of unequal contents despite count equality.
- Full normalized content comparison, references, timestamp/status validation and a coordinated source-write cutoff remain required. Do not rerun an insert-only migration and call it a complete delta sync.
- PostgreSQL adapter currently loads entire collections for find/count/page/scan and filters in Node. It does not reproduce all Mongo index/TTL constraints, and uses default PostgreSQL transaction isolation. Performance, uniqueness, lease concurrency and expiration semantics require dedicated validation before enabling production workers.

## Next prerequisites

1. Obtain verifiable access to the active writer host or Atlas connection/process diagnostics and establish its exact process/service identity.
2. Prepare and test PostgreSQL worker compatibility and repository behavior locally, then plan a coordinated handover and content-aware delta verification.
3. Supply an actual supported parser endpoint, token and response version; verify storage/scanner/Redis, catalog requirements and real CV processing before enabling production mode.
4. Correct and verify Google callback configuration in both application and provider console; supply Razorpay configuration for payment tests.
5. Use authorized test accounts/documents and test payment facilities for end-to-end verification; do not alter existing customer roles/payments merely to demonstrate passing results.

Atlas remains required and must not be deleted, disabled or disconnected.

## Step 1 follow-up — active writer tracing

- Atlas discovery heartbeat was still advancing at 2026-09-29T09:06:02.469Z; the job-engine lease owner was 6643b6e9-9334-47b8-a200-f00b3320f18c. This owner is a random lease identifier, not a host/PID.
- Atlas network access UI confirms only three existing IP entries remain; the new AWS static IP is absent. No access-list changes were made.
- The precise currentOp limitation is error 8000: idleConnections is not allowed in this Atlas tier. Removing that option makes the restricted active-operation query execute successfully; absence of returned operations does not prove absence of a writer.
- Atlas Real Time panel explicitly requires a cluster upgrade. No upgrade was performed.
- The job-engine CLI rejects a missing MONGODB_URI before using the shared store. The matching-index CLI has a similar guard. These are confirmed PostgreSQL startup incompatibilities; neither worker has been started in production during this investigation.
- Exact external writer host/PID remains unresolved. Asked the operator where the original backend/discovery worker is running. Do not stop an unidentified process or enable a competing production worker.

## Google authentication correction since the initial audit

- Corrected the live callback to /api/v1/auth/google/callback and registered the matching HTTPS callback in the existing Google OAuth client.
- Real browser Google login succeeded, returned to the application, and remained signed in after refresh. The earlier unavailable Google status in this report is superseded.

## Friend-host confirmation and source attribution limit

- Operator confirms the original backend/discovery worker is running on a friend's computer/server. Hostname, public egress IP and PID have not yet been supplied or independently verified.
- Read-only recheck: discovery-heartbeat updatedAt=2026-09-29T09:11:02.566Z, status=running.
- currentOp with allUsers=true is explicitly rejected by Atlas tier (code 8000); allUsers=false succeeds but returned no active operations. Thus the permitted diagnostics do not establish a client IP or process identity.
- Do not attribute any allowlisted IP to the friend without host-side evidence. The allowlist is permission, not an active-connection record.
- Next evidence required from the friend's host: OS/hostname, public egress IP, process/service command for the discovery worker, and established Atlas socket-to-PID mapping. Redact credentials; do not share .env files, connection strings or tokens. No stop, restart, configuration or migration action is authorized on the friend's host in this step.

## Worker compatibility preparation

- Operator supplied friend-host public IP 103.109.221.158 and a Windows socket inventory: node PIDs 17004 and 21896 match worker/launcher command patterns; PID 19956 also connects to the same database; all share parent PID 4716. The discovery-versus-semantic mapping and third process role remain unverified.
- DNS lookup independently matched Atlas members to 20.193.129.105, 4.240.85.220 and 20.244.37.49. These are remote database addresses, not the friend's source IP.
- Locally updated job-engine and matching-index startup guards to accept DATABASE_URL or MONGODB_URI, preserving the matching worker's DEMO_MODE=false requirement and shared repository selection. No deployed worker was started, stopped or changed.
- Added isolated child-process tests that verify both entry points reach the PostgreSQL driver with MongoDB absent, exit on a rejected local connection, and withhold connection credentials from diagnostics. All eight targeted runtime/startup tests passed.
- These tests do not establish PostgreSQL business-write equivalence, concurrency/lease safety, complete data reconciliation or readiness for live cutover. Those checks remain required before enabling new workers.
