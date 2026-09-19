# Job ingestion pipeline

The backend consumes records already fetched by an approved Job Source Strategy adapter. It processes each immutable source variant through fetch validation, parsing, normalization, validation, trust review, deduplication, managed-taxonomy enrichment, canonical storage, and the existing matching index adapter.

Incomplete or unverified provider facts remain explicit in `ingestion.missingFields`. Such jobs are stored with `status=review` and `trust=pending` (or `flagged`) and are excluded from public search and matching. No missing job facts or taxonomy mappings are inferred.

Duplicate jobs share one canonical record while retaining every source variant and provenance record. A source record received after the prior canonical job closed or expired is stored as a repost linked through `repostOf`.

Set `ENABLE_JOB_INGESTION_PIPELINE=true` only in the worker environment after MongoDB and Redis are configured. The local search implementation uses MongoDB. Live OpenSearch/vector indexing uses the existing `MATCHING_*` configuration; this pipeline introduces no new provider credentials.

Admin operations are available at `/api/v1/admin/ingestion/status`, `/api/v1/admin/ingestion/config`, and `/api/v1/admin/ingestion/run` and use the existing admin session and audit controls.
