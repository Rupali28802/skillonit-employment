# Semantic search and reviewed hiring-post intake

## Implemented

- Local 384-dimensional sentence embeddings using Transformers.js and Xenova/all-MiniLM-L6-v2. No paid inference key; model files download on first use and cache under node_modules, which is not committed.
- `GET /api/v1/jobs?q=patient%20care&searchMode=semantic` searches indexed public vacancies by cosine similarity (minimum 0.4). Structured filters and current publication/expiry restrictions still apply. Results expose a similarity score, not a probability of suitability or truth.
- Keyword search remains the default. The existing UI is unchanged. Semantic retrieval is explicitly selected through the API while the initial index is incomplete.
- `npm run jobs:index-semantic` builds missing/changed vectors, up to 10,000 per invocation. `npm run worker:semantic` incrementally processes 100 changed records per pass. Source text is fingerprinted; unchanged vectors are reused. Current implementation scans stored vectors and bounds candidate retrieval to 10,000; this is a development implementation, not the required production vector infrastructure.
- Additional review reasons for credential requests, unusual payment demands, shortened apply links and internationalized domains. These are review signals; legitimate listings may require manual clearance. No imported employer becomes verified automatically.
- Admin-only `POST /api/v1/admin/social-sources` records a permission-reviewed source (id, name, hostname, permissionEvidence, approved, expiresAt).
- Admin-only `POST /api/v1/admin/social-posts` accepts sourceId, externalId, url, text, postedAt and optional deleted. Source approval and expiry, exact hostname and timestamps are validated. Source/external ID deduplicates updates. Sanitized text/provenance and risk reasons are retained in a separate collection.
- Admin-only `GET /api/v1/admin/social-posts` returns the latest 100 intake records. Posts are review, flagged, stale or removed; never automatically inserted into confirmed jobs.
- Common pay periods normalize to annual/hourly/monthly/weekly/daily, while unknown units remain source text.

## Validation and limitations

A real local-model sanity check gave a nursing sentence similarity 0.567 versus plumbing 0.150 for a patient-care query (384 dimensions). This is one sanity check, not a multilingual relevance benchmark. The model is primarily English; comprehensive multilingual evaluation, generative structured extraction and model-quality thresholds remain unfinished.

Initial vector backfill must finish before claiming full current-catalog semantic coverage. A public job may remain absent until indexed; query results are explicitly limited to indexed public vacancies. No third-party social feeds have been connected and no provider approval is implied by the admin intake interface. Structured social-to-vacancy promotion with human-confirmed field evidence, full employer/domain verification, production vector search and wider normalization still require further engineering.

Provider-access holds remain in IMPLEMENTATION_AND_ACCESS_HOLDS.md. UI/authentication design is unchanged. Cached model weights and credentials must not be committed.

## Verified this rollout

Backend build and all 74 backend tests passed. Live semantic search returned searchMode=semantic with indexed public results; unauthenticated social review returned HTTP 401. Production dependency audit reported zero vulnerabilities; secret scan passed. API, ingestion worker and separate semantic worker restarted. Initial semantic catalog backfill remains in progress. No UI files changed.
