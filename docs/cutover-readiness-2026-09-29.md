# Cutover readiness — 29 September 2026

## Complete rolling manifest comparison — 1 October 2026

Read-only full manifests now supersede the earlier bounded/sample comparison. They are still rolling snapshots because neither live writer was paused.

- Atlas: `2026-10-01T06:44:12.636Z`–`06:48:28.783Z`, **189,185** documents, 92 collections, zero invalid business IDs.
- PostgreSQL: one `REPEATABLE READ READ ONLY` transaction at `2026-10-01T06:49:25.025Z`–`06:50:03.701Z`, **189,176** documents, 26 populated collections.
- Complete ID/hash comparison: **169,528 equal**, **14,095 shared IDs with different contents**, **5,562 Atlas-only**, **5,553 PostgreSQL-only**.
- The raw documents and credentials were not exported. Ignored local evidence contains only IDs, SHA-256 document/field fingerprints, aggregate counts and completion markers.

| Collection | Atlas | PostgreSQL | Equal | Different | Atlas only | PostgreSQL only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| jobFeedFingerprints | 46,892 | 46,760 | 45,500 | 0 | 1,392 | 1,260 |
| jobFeedRuns | 6,404 | 6,752 | 6,010 | 0 | 394 | 742 |
| jobFeedStates | 319 | 319 | 0 | 319 | 0 | 0 |
| jobFeedVariants | 54,584 | 54,347 | 45,099 | 8,342 | 1,143 | 906 |
| jobLifecycleEvents | 1,278 | 1,348 | 985 | 293 | 0 | 70 |
| jobVectors | 36,574 | 35,342 | 35,237 | 105 | 1,232 | 0 |
| jobs | 41,230 | 40,985 | 35,062 | 5,027 | 1,141 | 896 |
| auditLogs | 1,442 | 1,566 | 1,189 | 0 | 253 | 377 |
| rateLimits | 16 | 1,305 | 10 | 0 | 6 | 1,295 |
| sessions | 7 | 7 | 6 | 0 | 1 | 1 |

Smaller changed sets: analyticsRollups 3 content differences; jobEngineState 4; planConfigHistory has two PostgreSQL-only records; systemConfig/plans has one content difference; userRoleEvents has four PostgreSQL-only records; users has one content difference.

Top-level field hashing classified all 14,095 changed shared IDs without exposing values:

- `jobFeedStates`: scheduling/attempt timestamps differ on all 319; success timestamp 279; counts 19; status 7; error/failure state 5.
- `jobFeedVariants`: `lastSeenRun` 8,342; active/missing flags 25 each.
- `jobLifecycleEvents`: `changedAt` 293.
- `jobs`: feed 4,727; normalized facts and risk 4,671 each; discoveredAt 1,367; description 655; expiry 529; lifecycle 360; status 82; title 3; URL 2.
- `jobVectors`: fingerprint 105 and vector 38.
- State/config: analytics count/update time 3; job-engine generated/lease/coverage fields 4 records; plans value 1.

Conflict ownership findings:

- The single user conflict is Atlas `admin` versus PostgreSQL `student`. PostgreSQL has four later role events through `2026-09-30T07:34:12.410Z`, ending in Student; Atlas stops at the `2026-09-28T08:55:33.433Z` Employer→Admin event. Preserve the PostgreSQL role and event history.
- PostgreSQL has two later plan-history records at `2026-09-30T05:08:32.303Z` and `05:09:02.025Z`; Atlas plan history stops at `2026-09-22T11:14:29.657Z`. Preserve PostgreSQL plan configuration/history.
- PostgreSQL sessions, rate limits, audit records and administrative history contain legitimate post-migration application activity and must not be overwritten to match Atlas counts.
- Discovery collections show independent live-writer evolution. Atlas-only/PostgreSQL-only jobs and content conflicts require a final write boundary plus collection-specific union/latest-state rules; an insert-only rerun is unsafe.
- Atlas has 1,232 additional vectors. Final canonical jobs should be reindexed with the approved semantic model after cutover instead of assuming either rolling vector set is complete.

Writer evidence at `2026-10-01T07:01Z`:

- Atlas discovery heartbeat: `2026-10-01T07:01:18.560Z`, running.
- AWS PostgreSQL discovery heartbeat: `2026-10-01T07:01:22.058Z`, running, PID 50125 on `13.204.245.237`.
- The inspected Windows host `SAPNOKASAFAR` has public IP `103.109.221.158` but no SkillOnIT worker-pattern Node process and no active port-27017 socket at `07:01:07Z`. The active Atlas writer is therefore not attributable to a process on this inspected host at that time. Another machine behind the same NAT or another allowed source remains possible.
- A permitted `currentOp` query subsequently observed application name `Skillonitemployment` querying the `Skillonitemployment.jobs` namespace from public address `103.109.221.158`. This ties the active source workload to that NAT/public IP but cannot reveal the private machine hostname or Windows PID. Atlas tier error 8000 prevents the richer operation mode; no tier/configuration change was made.

**Decision remains NO-GO:** full rolling drift is now quantified and critical account/config ownership is resolved, but the currently advancing Atlas writer still lacks fresh host/PID/service attribution. No final source boundary or delta can be certified until that process is identified and later explicitly authorized for fencing.

## Read-only follow-up — 1 October 2026

**Decision remains NO-GO. Atlas and all legacy processes remain unchanged.**

- A production PostgreSQL `REPEATABLE READ READ ONLY` snapshot at `2026-10-01T06:29:57.835Z` counted **189,155** documents. Critical counts were: users 11, jobs 40,985, applications 6, jobFeedVariants 54,347, jobFeedFingerprints 46,760, jobVectors 35,342, jobFeedStates 319, jobFeedRuns 6,737, auditLogs 1,566; employers, profiles, CV documents/versions, subscriptions and payments were empty.
- Duplicate preflight across all **33** proposed business-key definitions returned **zero conflict groups**. Production still has only **11** indexes (primary key, collection/update index, and nine existing business-key indexes). The proposed constraints were not installed.
- Fresh relationship checks returned zero missing references for applications to users/jobs, onboarding to users, variants/fingerprints/vectors to jobs, and zero document/storage ID mismatches. All **6 applications reference employer IDs while the employers collection is empty**. A follow-up aggregate check classified all six as external applications against discovered feed jobs; each application employer ID matches its job employer ID, and all six jobs contain feed attribution. The application engine requires an `employers` row only for `direct` jobs. This is therefore an intentional polymorphic source/company identity rather than evidence of six missing employer-account rows. It also means an unconditional application-employer foreign key would be incorrect without separating account-owned and externally discovered jobs. No records were modified.
- Recent PostgreSQL activity confirms the AWS discovery worker is writing jobs, variants, feed states/runs and engine state. The exact AWS production processes were backend PID **50124** (`node dist/index.js`), discovery PID **50125** (`node dist/job-engine/cli.js watch`), and frontend PID **50126** (`npm start`) on host `13.204.245.237`. The production environment contains `DATABASE_URL` and no MongoDB/Atlas variable. No application cron, systemd application timer, or Docker writer was found.
- Semantic (`watch-semantic`) and matching-index commands exist in source but were not running as separate AWS processes. The active discovery command also does not run either command internally.
- A bounded read-only Atlas probe could not start because `/home/ubuntu/skillonit-employment/backend/.env.migration` is an empty, zero-byte file and the production environment has no `MONGODB_URI`. No Atlas URI was displayed or created, and Atlas access rules were not changed.
- The friend-host writer evidence remains historical: Windows public IP `103.109.221.158`, worker-pattern PIDs 17004 and 21896, additional Atlas-connected PID 19956, common parent 4716. A fresh hostname/command/role/PID inventory is still required before any writer shutdown.
- All three AWS services remained active after the audit. Temporary audit/probe files were removed. The discovery service's prior stop exceeded systemd's timeout and required SIGKILL; graceful shutdown remains an operations issue for a later reviewed change.

### Current blockers to a cutover proposal

1. Obtain a fresh read-only process/command/socket inventory from the machine currently advancing the Atlas heartbeat. Historical PIDs 17004, 21896 and 19956 are no longer present on the inspected `103.109.221.158` Windows host; identify their current replacements, host/service and restart mechanism.
2. At the later approved write boundary, generate final manifests and resolve the quantified discovery drift with reviewed collection-specific rules. The full rolling comparison is complete, but it is not a simultaneous final delta.
3. Review and explicitly approve installation of the preflighted PostgreSQL constraints/indexes in a controlled window. Do not add an unconditional application-employer foreign key: external feed applications deliberately use a non-account employer identity. No schema change is authorized by this audit.

The rollback sequence remains: fence newly started PostgreSQL workers first; preserve both stores and the final source watermark; reconcile any writes made after the boundary before re-enabling a legacy writer; revert only the identified project service/configuration; and keep Atlas available until post-cutover acceptance.

### Prepared credential-safe source evidence

`backend/scripts/export-atlas-reconciliation-manifest.mjs` now provides a read-only source-manifest path for the friend host. It uses that host's existing `MONGODB_URI`, opens only one secondary-preferred connection, excludes MongoDB `_id`, and writes collection/id/SHA-256 tuples plus aggregate counts and completion markers. It never writes to Atlas and never outputs the connection string or document bodies. Output names matching `.atlas-reconciliation-manifest*.jsonl` are ignored by Git.

The exporter passed an isolated MongoDB test: three valid documents across two collections produced three SHA-256 rows, one invalid/missing business ID was counted without exporting the document, and the manifest carried a complete marker. The missing-credential path fails closed before creating output. A production source run remains external because no authorized Atlas credential exists in the current workspace or AWS migration environment.

From the existing backend directory on the friend host, after receiving this file through an approved transfer, the read-only run is:

```powershell
node --env-file-if-exists=.env scripts/export-atlas-reconciliation-manifest.mjs
```

Run `scripts/inspect-atlas-writers.ps1 -IncludePublicIp` in a separate PowerShell window at approximately the same time. Transfer the resulting manifest and redacted inventory through the approved project channel; do not paste or transfer `.env`, a URI, tokens, or passwords. This is a live rolling read, not a coordinated source snapshot, so it supports reconciliation but does not replace the final authorized write boundary.

**Decision: NO-GO. Read-only assessment; no deployment or live worker changes.**

## Fresh evidence

- PostgreSQL repeatable-read, read-only snapshot: 10:00:03–10:00:25 UTC, 179,349 documents. Full document hashes and selected status/timestamp hashes were exported to an ignored local manifest, without exporting raw customer documents.
- MongoDB full-document comparison started at 10:01 UTC. Users: 11/11 identical. Feed sources: 319/319 identical. Feed states: 319 on each side, 295 identical and 24 changed; nextRunAt and lastAttemptAt differ on 24, lastSuccessAt on 23, status on one. The scan reached 10,000 jobs then failed with MongoNetworkError. These are observations from the first attempt's console/checkpoint, not a complete reconciliation result.
- Retry at 10:09 UTC failed with MongoServerSelectionError before scanning collections. The current checkpoint describes that retry; it does not retain the first attempt's successful collection results. Full comparison, duplicate-ID coverage, Mongo reference integrity and exact complete mismatch totals remain unverified. Neither scan represents a simultaneous snapshot of both live databases.
- Fresh PostgreSQL relationship queries found zero missing references or orphans for applications → users/jobs (6 applications), onboarding → users (4), variants → jobs (52,033), fingerprints → jobs (44,125), vectors → jobs (35,342). Employers, profiles, subscriptions, payments and matchingIndexState were empty in these checks; empty checks are not functional workflow verification. Document id versus storage id mismatch count: zero.
- Live PostgreSQL schema: primary key (collection,id), collection/updated_at index, nine business-key unique indexes. No foreign-key constraints were returned. The proposed 33-key read-only duplicate preflight returned zero conflict groups. Proposed indexes/concurrency fixes are NOT deployed.
- AWS backend process: PID 25277, dist/index.js, active; PostgreSQL configuration present, Atlas environment configuration absent. Two other Node processes (10884,10957) had neither variable in their initial process environment. This environment inspection alone cannot exclude configuration loaded later or prove their full purpose. No application worker timer appeared in the inspected systemd timer list. This is not a complete inventory of every remote host/container/scheduler.

## Source worker attribution

User-reported Windows source public IP: 103.109.221.158. Previously reported node.exe PIDs 17004 and 21896 matched the worker-command search; PID 19956 also held Atlas connections. All had parent 4716. These PIDs are historical, not freshly verified. Hostname and exact role-to-PID mapping remain unknown. Port 27017 connections establish connectivity, not which write each process performs.

The discovery watch code writes jobEngineState/discovery-heartbeat; discovery ingestion also writes jobs, jobFeedVariants, jobFeedFingerprints, jobFeedStates, jobFeedRuns and jobFeedSources. Semantic processing writes jobVectors. These are code paths, not proof assigning either role to a particular PID. Obtain the fresh read-only output from scripts/inspect-atlas-writers.ps1 before any cutover. Atlas's available current-operation inspection did not provide sufficient attribution to certify all writers.

## Earlier evidence (not a fresh full comparison)

The prior bounded audit found changed jobs/variants/feed states and 22 more vectors in MongoDB. Auth/session/audit counts also differed. Do not treat earlier samples as a complete missing-record list. The prepared fixes passed 17 isolated PostgreSQL integration checks and eight regression checks; see postgres-worker-fixes-2026-09-29.md. These results do not establish live deployment readiness or capacity.

## Required sequence for a later authorized cutover

1. Restore read-only Atlas connectivity without disabling Atlas; finish full manifests, business-key and relationship checks. Record per-collection timestamps and repeat on a consistent final write boundary.
2. Identify every source writer, exact host/PID, parent, service/task/container and automatic restart mechanism. Include API, discovery, semantic, matching and scheduled jobs. Resolve unknown PID 19956.
3. Review conflicts by business ownership. Preserve newer legitimate PostgreSQL account/session/payment activity. Do not overwrite all target data from Atlas or infer deletion merely from absence. The existing insert-only migration is insufficient for changed documents.
4. Confirm tested backups/restoration and record code/config/schema checkpoints for both stores. Review production query performance, contention, worker schedules, Redis and retention readiness.
5. Only with separate cutover authorization: fence the identified writers in a maintenance window; record the final source watermark; apply reviewed inserts/updates/deletions with conflict handling; verify hashes, keys, references and statuses. Take a further checkpoint before schema/data changes.
6. Deploy reviewed concurrency fixes and guarded 33-key schema setup in a controlled window. Re-run duplicate preflight at deployment time. This step can acquire a table lock and is not authorized by this readiness request.
7. Start one intended owner per worker role against PostgreSQL, checking leases, replay/idempotency, processing lag, failed writes, semantic/matching results and application workflows. Keep Atlas available throughout acceptance.

## Rollback

Define error/lag/integrity thresholds and the decision owner before cutover. If validation fails, fence the new PostgreSQL workers first. Prefer reverting compatible code while keeping PostgreSQL if feasible. If returning writers to Atlas, reconcile all legitimate PostgreSQL changes since cutover before resuming the old processes. Restoring a pre-cutover snapshot alone would lose those writes. Restore only the identified project processes/configuration; never permit independent writers on both stores unintentionally. Keep both snapshots and audit evidence. Do not remove Atlas until explicit post-acceptance approval.

## Remaining gates

Full reconciliation; fresh Windows process attribution and all-writer inventory; reviewed conflict resolution; production deployment of tested constraints/concurrency fixes; backup/restore and performance validation; authorized final delta/cutover window. CV parser/provider and Razorpay configuration plus remaining live business workflows are separate overall production acceptance blockers.

No production business data or schema was changed. Read-only audit helper files were copied to the project directory on AWS. No service was stopped/restarted, no Atlas setting was changed, and nothing was committed or pushed.
