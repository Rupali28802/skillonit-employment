# Job Source Strategy

The source strategy is disabled by default. It acquires source records only from an explicitly approved and enabled source. The initial adapter uses the official Greenhouse Job Board API and needs no credential.

## Runtime configuration

- `ENABLE_JOB_SOURCE_STRATEGY=true` enables the one-minute scheduler in the operations worker.
- `JOB_SOURCE_PROVIDER_TIMEOUT_MS` bounds each provider request (default `10000`).
- `JOB_SOURCE_SCHEDULER_BATCH_SIZE` bounds sources claimed per scheduler pass (default `20`).
- The worker still requires the repository's existing `MONGODB_URI` and `REDIS_URL` configuration.

Source-specific schedule, rate, retry, compliance evidence, permitted method, jurisdictions and provider configuration are stored in `jobSources`. No provider secrets are accepted by the current API contract.

## Operations

Admins use `GET /api/v1/admin/sources`, `POST /api/v1/admin/sources`, and revision-protected `PATCH /api/v1/admin/sources/:id`. A source cannot be enabled until its compliance status is approved. `POST /api/v1/admin/sources/:id/run` performs a controlled manual run. `GET /api/v1/admin/sources/:id/events` returns redacted operational events.

Provider records are written idempotently to `jobSourceVariants` with source provenance and `needs_normalization` status. This capability does not publish jobs or invoke matching/application behavior.

Transient and rate-limit failures use bounded exponential retry. Authorization, configuration, contract and permanent failures stop automatic retries after classification. Exhausted sources enter `failed` health and require an admin review before re-enabling. Events contain fixed codes and counts only; provider payloads are never logged.

## Rollback and emergency pause

Set `ENABLE_JOB_SOURCE_STRATEGY=false` and restart the operations worker to stop scheduled acquisition globally. Set an individual source's `enabled` field to `false` for a source-specific pause. Existing provenance and audit records remain intact.
