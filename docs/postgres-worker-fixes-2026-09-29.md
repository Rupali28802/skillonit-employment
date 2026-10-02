# PostgreSQL worker fixes — 29 September 2026

## Status

Implemented and verified in an isolated checkout and temporary PostgreSQL databases. **Not deployed to the running application. No live worker switch, Atlas changes, commit or push.** The earlier verification report describes the still-deployed baseline, not these updated files.

## Changes

- `postgres-store.ts`: SERIALIZABLE transactions, up to eight attempts on serialization/deadlock errors, bounded exponential delay with jitter, full rollback and connection release between attempts. Unique violations and business errors are not blindly retried. Transaction callbacks must remain replay-safe, as with the existing MongoDB transaction implementation.
- `postgres-constraints.ts`: all 33 business-key definitions from the existing MongoDB store, including compound keys and partial string-key conditions. JSONB expressions preserve scalar type distinctions; missing and explicit null share a unique key where MongoDB's non-sparse index does so. These application keys are scalar fields; this is not a general MongoDB multikey-index emulator.
- Schema setup preflights duplicate groups without returning customer values, refuses conflicting data, and installs replacements atomically while holding a table lock. The nine weaker legacy indexes are removed only within the successful replacement transaction. No conflicting documents are automatically deleted or rewritten. This requires a controlled deployment window; startup lock acquisition is bounded to ten seconds.
- PostgreSQL expiry cleanup handles the 15 existing TTL collections in bounded batches, skipping locked records. Only valid canonical UTC ISO date strings in expiresAtDate qualify; future, missing, malformed and relative dates remain intact. Requires PostgreSQL 16+ for pg_input_is_valid (tested on 18.6).
- Existing retention worker integration runs every minute when PostgreSQL is configured; MongoDB's existing schedule remains unchanged. Cleanup is asynchronous and requires the queue worker/Redis to be running. No live queue worker was started.
- Registration maps PostgreSQL unique-violation code 23505 to the same account-exists response as MongoDB duplicate-key errors.
- Previously prepared discovery/semantic and matching entry-point guards accept PostgreSQL configuration without requiring a MongoDB connection string.

## Verification

**17/17 PostgreSQL integration checks passed**, including all five former failures:

- Discovery ingestion and repeat ingestion preserve one job, variant and fingerprint.
- Rollback, concurrent independent writes, and same-ID replay.
- Four concurrent read-modify-write increments all persist.
- One winner for discovery and matching leases.
- Three separate processes preserve all 30 increments and produce one lease owner.
- All 33 unique-key definitions reject conflicting business keys; partial-key and null behavior tested.
- Expiry cleanup respects the batch limit and retains future/malformed/unrelated records.
- A deliberately conflicting isolated dataset blocks schema setup without changing its records.
- Real local semantic model extraction, vector persistence and replay.
- Matching state and restart-safe replay against PostgreSQL.
- **Real configured embedding provider and Aiven search service**: generated an embedding for synthetic test content, indexed it in a unique temporary index, retrieved it, skipped unchanged replay, removed the document, and deleted the temporary index. No production search index or customer document was changed.

Final temporary PostgreSQL database removal was confirmed: skillonit_verify_1790675761023. Temporary external index cleanup succeeded. Provider credentials were neither printed nor copied into the checkout.

**8/8 additional regression checks passed**: MongoDB retention/readiness, queue execution and schedule behavior, runtime configuration, safe startup failures, and PostgreSQL-only worker startup. Backend TypeScript check, production build, syntax/diff checks and source secret-pattern scan passed.

Read-only production preflight found **zero duplicate groups** for the proposed 33 unique-key definitions. This is a point-in-time check, not permission to skip the guarded deployment-time preflight. Production application data and schema were not altered by this check.

## Remaining before deployment/cutover

1. Review query performance at production volumes: collection-wide find/count/page/scan remain in the adapter. SERIALIZABLE correctness may expose contention/retry exhaustion; no high-load capacity guarantee is claimed.
2. Obtain a fresh friend-host role/PID inventory. Reported source IP 103.109.221.158 and connected PIDs 17004/21896/19956 with parent 4716 are known, but exact role attribution remains unresolved and PIDs may change.
3. Complete content-aware reconciliation. The prior audit found changed jobs, states, variants and a 22-vector count difference. Both systems remain active; insert-only migration or count matching is insufficient. Preserve legitimate PostgreSQL sessions/audits and explicitly resolve shared-record conflicts.
4. In an authorized cutover window, establish the source write boundary, take backups/rollback checkpoints, apply the reviewed fixes with the guarded schema migration, finish delta verification, then enable the identified PostgreSQL workers. Validate the retention worker schedule/Redis, leases and live business behavior. Keep Atlas until acceptance.
5. CV parser/provider configuration and catalog setup, Razorpay configuration and the remaining full production workflows are separate outstanding blockers. No credentials or provider settings were invented.

This fixes the reproduced code defects and validates the external matching path in isolation. It does not claim production migration is complete.
