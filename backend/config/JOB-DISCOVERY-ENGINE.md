# Job Discovery Engine

The discovery engine coordinates the approved providers configured by the Job Source Strategy. It does not normalize, publish, search, match or apply to jobs.

## Activation

Set `ENABLE_JOB_DISCOVERY_ENGINE=true` only after at least one source has genuine compliance approval. The database-backed operations worker requires MongoDB or PostgreSQL and invokes the discovery scheduler once per minute. `ENABLE_JOB_SOURCE_STRATEGY` remains a compatibility fallback for existing deployments.

The database policy controls the maximum sources per run, source freshness objective, discovered-variant retention (maximum 90 days), and minimum healthy source count. Admins manage it through `PUT /api/v1/admin/discovery/config`.

## Operations

- `GET /api/v1/admin/discovery/status` returns policy, source freshness/health counts and recent runs.
- `POST /api/v1/admin/discovery/run` starts a manual bounded run and may select approved source IDs or a jurisdiction.
- Scheduled selection includes enabled, approved, due, non-failed sources and prefers the least recently run source.
- Manual selection may ignore the next-run time but never bypasses source approval, enablement, health, rate limits or leases.
- Runs finish as `COMPLETED`, `DEGRADED`, `FAILED`, `EMPTY` or `PAUSED` and contain only source IDs, counts and safe error codes.
- Discovered variants older than the configured retention become `stale`; canonical job lifecycle remains owned by the existing lifecycle component.

Pause globally by setting `ENABLE_JOB_DISCOVERY_ENGINE=false` and restarting the worker. Existing source variants, run history and audit records remain available for operational review.
