# PostgreSQL worker verification — 29 September 2026

## Decision

**FAIL: not safe for worker cutover.** Verification reproduced lost updates, concurrent lease acquisition and missing business-key uniqueness. No application fixes, production schema changes, migration, commits or pushes were performed in this verification step.

## Isolation and scope

- Executed existing discovery, semantic and matching-index implementation against temporary, newly created `skillonit_verify_<timestamp>` databases on the existing PostgreSQL server. Production application rows were never written by these tests.
- Each test database was removed after its connections closed; final run confirmed removal of `skillonit_verify_1790674809028`. Nothing in MongoDB was removed or modified.
- Used a synthetic discovery response only inside the isolated integration test. Real normalization, discovery ingestion and repository code performed the writes. No fake records entered production.
- Semantic verification used the real `Xenova/all-MiniLM-L6-v2` feature-extraction pipeline and isolated vector storage. It verified the first indexing pass writes a vector and a repeat pass skips unchanged content.
- Matching-index write/replay/deletion used an explicit in-memory search-provider test double with real PostgreSQL state persistence. Separately, the production Aiven provider answered a read-only retrieval request (zero matches). Production external indexing and embedding-provider writes have NOT been verified.
- Production PostgreSQL inspection used SELECT queries; content snapshot ran in a REPEATABLE READ READ ONLY transaction. MongoDB comparison used read-only cursors. Live activity continued throughout, so the two datasets are not a simultaneous cutover snapshot.
- The production adapter uses READ COMMITTED. Remote worker modules matched the inspected local implementation; adapter source had formatting differences but the same relevant query/transaction/index behavior.

## Targeted integration results

| Check | Result | Evidence |
| --- | --- | --- |
| Sequential discovery ingestion and replay | PASS | One job, variant and fingerprint after two ingestion runs; two run records. |
| Rollback | PASS | A write followed by a thrown error left no record. |
| Concurrent distinct-ID writes | PASS | All eight records persisted. |
| Concurrent same-ID replay | PASS | Eight identical upserts produced one record. |
| Concurrent read-modify-write | FAIL | Four transactions read the same counter; final value was 1 rather than 4. |
| Discovery lease exclusivity | FAIL | Both competing transactions reported acquiring `jobEngineState/job-engine`. |
| Matching lease exclusivity | FAIL | Both competing transactions reported acquiring `systemConfig/matching-index-lease`. |
| Matching state persistence/replay/deletion | PASS, LIMITED | Real PostgreSQL state with a search-provider test double. External end-to-end indexing remains unverified. |
| Unique user email | PASS | Duplicate email rejected with PostgreSQL 23505. |
| Unique payment provider ID | FAIL | Distinct payment IDs with the same providerPaymentId were both accepted. |
| Unique application user/job pair | FAIL | Distinct application IDs with the same userId/jobId were both accepted. |
| Semantic extraction/write/replay | PASS | Real model produced one vector; unchanged second pass indexed zero. |

Final suite result: **6 passed, 5 failed; exit code 1**. Initial fixture used a `.test` URL rejected by normal application validation; corrected to the existing tests' example.com convention before the reported runs. This was a fixture correction, not a production-code change.

## Root causes and constraints

- `backend/src/lib/postgres-store.ts`, `postgresTransaction`: plain BEGIN, no serializable retry or atomic lease acquisition. `get` followed by `put` is not atomic across transactions; upsert alone prevents duplicate primary keys, not lost updates or multiple successful lease claims.
- Discovery uses the read-check-write lease in `backend/src/job-engine/engine.ts`; matching uses the same pattern in `backend/src/matching-index.ts`. The tests exercised both collection/record patterns with synchronized contenders.
- Production has a primary key on (collection,id), nine business-key unique indexes and one collection/updated_at index. It has NOT NULL constraints but no foreign keys.
- Atlas metadata contains 33 business-key unique indexes (excluding `_id` and `id`) and 15 TTL indexes. Only nine corresponding unique key definitions are present in PostgreSQL; complete semantic equivalence, including partial/null behavior, is not established even for those nine.
- PostgreSQL does not automatically implement MongoDB TTL semantics. Equivalent expiration/maintenance behavior must be explicitly implemented or demonstrated.
- The application adapter still loads entire collections for find/count/page/scan. These small integration fixtures do not prove acceptable performance at production volumes.

## Production relationship checks

Zero missing/nonexistent references in:

- Six applications to users and jobs.
- Four onboarding records to users.
- 52,033 feed variants to jobs.
- 44,125 feed fingerprints to jobs.
- 35,342 vectors to jobs.

No app_documents id/data.id mismatches. Employers, profiles, subscriptions, payments and matchingIndexState were empty; their empty checks are not workflow passes. These are selected application relationships, not an exhaustive relational integrity proof.

## Live worker attribution

- Operator identifies the friend's Windows machine as source, with reported public IP `103.109.221.158`, matching an Atlas access-list entry.
- Friend-supplied socket inventory: worker-pattern node.exe PIDs **17004** and **21896**, plus another Atlas-connected node.exe PID **19956**, all parented by **4716**.
- Atlas member DNS independently resolved to **20.193.129.105**, **4.240.85.220**, **20.244.37.49**, matching those sockets.
- This proves connections to the cluster at the time of the supplied inventory. It does not distinguish discovery from semantic indexing or identify PID 19956's command. The parent launcher role is also unconfirmed. PIDs may change.
- Exact live role-to-PID attribution remains **BLOCKED pending a fresh host-side process-role inventory**. No connection was killed or access rule revoked. Only temporary audit/test processes were run or managed.

## Required steps before cutover

1. Implement atomic/exclusive lease acquisition and concurrency-safe updates/retries; rerun the failing tests and actual multi-worker contention tests.
2. Restore missing unique-key constraints with duplicate preflight checks, and verify all MongoDB partial/null/TTL semantics have equivalents. Do not delete records to satisfy constraints.
3. Verify matching against an isolated external search index using the actual configured embedding/search providers, including retry/restart behavior.
4. Load-test repository queries against representative volumes without touching customer data; fix full-collection scans where required.
5. Obtain a fresh hostname/process-role/PID/socket inventory from the friend's Windows host; explicitly identify discovery, semantic, API and launcher processes.
6. Prepare a content-aware delta reconciliation that preserves legitimate writes on both sides, resolves conflicts explicitly and handles inserts/updates/deletions. The current insert-only migration script is insufficient.
7. Only in a separately authorized cutover window: quiesce the identified source writers, run final consistent reconciliation and constraints/reference checks, then start PostgreSQL workers and verify leases, heartbeats, writes, retries and business behavior. Retain rollback capability and Atlas until acceptance.

## Live health

After tests, both employment systemd services were active; public API health and homepage returned HTTP 200. Friend's workers, DNS, Atlas access rules and production application code were unchanged. No commit or push was made.

## Production reconciliation evidence

PostgreSQL snapshot: 2026-09-29T09:38:29.626Z to 2026-09-29T09:38:57.550Z. MongoDB comparison: 2026-09-29T09:44:35.753Z to 2026-09-29T09:45:16.333Z.

Counted all 92 collections: PostgreSQL 179307 records; MongoDB 179246 records. Examined 3492 MongoDB documents by canonical SHA-256 content hash; 41 corresponding IDs had different contents. Top-level MongoDB _id was excluded, object keys sorted recursively, BSON values normalized through JSON serialization to match migration semantics.

Full contents were checked for collections of at most 2,000 documents. Five larger collections used 100 evenly distributed target-ID samples each: jobs, jobFeedVariants, jobFeedFingerprints, jobFeedRuns, jobVectors. This cannot establish full equality or enumerate source-only IDs in those larger collections. An earlier full fingerprint scan matched all 44,125 fingerprint records, but the final bounded comparison does not extend that proof to other large collections.

**Full reconciliation is NOT verified.** The bulk Atlas scan was curtailed because it was slow against the active source. Counts are per-collection reads rather than a single MongoDB snapshot; no writes were paused. Drift is confirmed, but these observations alone do not classify each difference as corruption, legitimate post-migration activity, or stale migration content.

| Collection | PostgreSQL | MongoDB | Scope | Different contents | Mongo-only IDs | PostgreSQL-only IDs |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| analyticsRollups | 15 | 15 | full | 1 | 0 | 0 |
| auditLogs | 1193 | 1189 | full | 0 | 0 | 4 |
| jobEngineState | 43 | 43 | full | 4 | 0 | 0 |
| jobFeedStates | 319 | 319 | full | 24 | 0 | 0 |
| jobFeedVariants | 52033 | 52033 | 100-ID sample | 4 | not enumerated | not enumerated |
| jobVectors | 35342 | 35364 | 100-ID sample | 0 | not enumerated | not enumerated |
| jobs | 38722 | 38722 | 100-ID sample | 8 | not enumerated | not enumerated |
| rateLimits | 93 | 16 | full | 0 | 6 | 83 |
| sessions | 9 | 7 | full | 0 | 0 | 2 |

All 11 user documents and six application documents matched in full. Zero-record employer/payment/CV/profile collections do not validate those workflows. A vector-count difference of 22 is confirmed; missing vector IDs were not fully enumerated. Do not overwrite PostgreSQL sessions, audits or rate-limit records from Atlas just to make counts equal.

### Fields differing in the follow-up comparison

- jobs: 8/100 differed; fields: feed (8), risk (7), normalizedFacts (7), description (1), status (1), lifecycle (1), expiresAt (1).
- jobFeedVariants: 4/100 differed; fields: lastSeenRun (4).
- jobEngineState: 4/43 differed; fields: total (1), domains (1), sources (1), countries (1), worldwide (1), generatedAt (1), completeness (1), employmentTypes (1), unknownGeography (1), updatedAt (2), version (1), owner (1), until (1).
- jobFeedStates: 24/319 differed; fields: status (1), nextRunAt (24), lastAttemptAt (24), lastSuccessAt (23), counts (9).

These differences include business status/description/expiry as well as worker timestamps, so reconciliation must be content-aware rather than counts-only or inserts-only. No field values or customer records are included in this report. Backend typecheck, verification-harness syntax check and source secret-pattern scan passed; the integration suite intentionally remains failing on the five reproduced blockers.
