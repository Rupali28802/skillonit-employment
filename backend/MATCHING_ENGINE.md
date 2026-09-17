# Enterprise job matching backend

Extends the existing confirmed-profile matching foundation. Scope references:
Enterprise Master Specification sections 22–24 (retrieval, taxonomies, matching),
57 (search abstraction), and configurable ranking requirements. Application
eligibility, automatic applications, Gmail, sending and frontend are unchanged.

## Implemented behavior

- `GET /api/v1/me/matches` retains the existing array response. Optional `q`,
  `limit` (1–30), `offset` (0–500) are validated. Identity comes only from the
  existing authenticated student session, never a query-supplied user ID.
- `GET /api/v1/me/matches/details` adds policy/profile/CV revision metadata,
  provider status, semantic status, degradation reasons, candidate-pool size,
  truncation and next offset. Dashboard uses the same ranking implementation.
- Mandatory published/verified/unexpired job gates, verified student account,
  exclusions, selected location/mode/type/industry, comparable salary range,
  mandatory skills, structured education and work authorization. Experience and
  occupation can be hard gates through policy. Unknown hard facts are explicitly
  `NEEDS_REVIEW` (or excluded by policy), never silently treated as qualified.
- Scores combine catalog-normalized skills, occupation family/aliases,
  experience, structured education, hierarchical locations, salary, arrangement,
  keyword evidence, cosine similarity, verified trust and decaying freshness.
  Every factor includes its weight, value, points and unknown/mismatch status.
  Scores are relevance, **not** permission to apply or send an application.
- Salary compares matching currencies and explicit periods only. Monthly/yearly
  normalization uses 12 months; no invented currency rates or contracted hours.
  No degree equivalence is guessed: administrator-approved equivalences only.
- `GET/PUT /api/v1/admin/matching-policy` provides strict, revision-checked policy
  management. PUT body is `{ expectedRevision, policy }`; administrator role is
  checked against the database. Changes produce a content-free audit event.
- Local retrieval scans verified published jobs in stable ID pages, bounded by
  policy (default 5,000), then ranks a bounded pool (default 200). This fallback
  is explicitly reported as degraded; it is not global indexed search.

## Confirmed facts and privacy

The canonical confirmed profile is the only candidate source. Existing CV
review/confirmation writes approved facts into that profile; this engine does
not read extraction drafts, raw CV files or unapproved CV versions. Explicitly
unconfirmed provenance fields are removed, including structured matching facts.
Revoked profile-processing consent stops matching. Legacy manually confirmed
profiles retain compatibility.

Optional `profile.matching` fields: `occupationIds`, `educationLevels`,
`educationFields`, `authorizedCountries`, `requiresSponsorship`, `locationId`.
Optional `job.matching` fields: `occupationId`, `locationId`, `requiredSkills`,
`requiredEducationLevels`, `requiredEducationFields`, `workAuthorizationRequired`,
`sponsorshipAvailable`, `salaryPeriod`, `experienceRequired`.
Preferences salary accepts `period: hour|month|year`.
These fields pass the existing candidate-confirmation and job write APIs; they
are not backfilled with guesses. Location preference matching uses selected
locations, not the candidate's residence as an implied restriction.

Candidate embeddings require both explicit deployment permission and granted
profile-processing consent. Only confirmed role/skills/structured education/title
facts are sent; contact fields, employer names and raw CVs are excluded. Obvious
emails, phone numbers and URLs in free text are scrubbed. This is minimization,
not a guarantee of anonymization; configure an approved processor and privacy
notice before enabling external candidate processing. Candidate vectors are
request-local, not logged or persisted by this engine.

## OpenSearch and embedding configuration

No environment file was edited. Supply actual values privately through the
deployment secret manager; never commit them.

| Variable | Contract |
|---|---|
| MATCHING_SEARCH_PROVIDER | `local` (default) or `opensearch` |
| MATCHING_OPENSEARCH_URL | Trusted HTTPS cluster root, no userinfo/query |
| MATCHING_OPENSEARCH_AUTHORIZATION | Secret Basic or Bearer authorization header |
| MATCHING_OPENSEARCH_INDEX | Lowercase index identifier; default `skillonit-jobs-v1` |
| MATCHING_SEMANTIC | `off` (default) or `on`; requires OpenSearch |
| MATCHING_EMBEDDING_URL | Trusted HTTPS OpenAI-compatible embeddings endpoint |
| MATCHING_EMBEDDING_TOKEN | Secret provider credential |
| MATCHING_EMBEDDING_MODEL | Exact model identifier returned by provider |
| MATCHING_EMBEDDING_VERSION | Deployment model revision identifier |
| MATCHING_EMBEDDING_DIMENSIONS | Exact dimension, 2–4096 |
| MATCHING_ALLOW_CANDIDATE_EMBEDDINGS | `true` only after processor/privacy approval |
| MATCHING_PROVIDER_TIMEOUT_MS | 100–30000; default 5000 per HTTP attempt |

Transport enforces HTTPS/certificate validation, rejects redirects, bounds
response bodies, retries selected transient HTTP errors once and opens a short
circuit after repeated failure. Provider error bodies never reach client/logs.
AWS OpenSearch SigV4 authentication is not implemented; this adapter requires a
compatible HTTPS Basic/Bearer deployment. Do not place keys in endpoint URLs.

Indexed keyword retrieval uses `multi_match`, not executable query-string syntax.
Semantic retrieval uses Lucene HNSW cosine vectors, with lifecycle and embedding
version filters inside k-NN. Keyword/vector candidates are unioned, deduplicated
and hydrated from MongoDB. Deleted/unavailable jobs cannot be resurrected by the
index. Stale fingerprint/model vectors never receive semantic credit.

Provider contracts follow official [OpenSearch k-NN documentation](https://docs.opensearch.org/latest/query-dsl/specialized/k-nn/index/),
[vector mappings](https://docs.opensearch.org/latest/mappings/supported-field-types/knn-vector/)
and [embedding API schema](https://developers.openai.com/api/reference/resources/embeddings/methods/create).
Contract tests use transport doubles; they are not live provider validation.

## Index operation and remaining deployment work

`npm run matching:index` is a restart-safe bounded index synchronization command.
It requires real MongoDB configuration with DEMO_MODE already false; it does not
change that flag. It obtains a database lease, checks/creates a dedicated index,
upserts changed jobs, removes expired/deleted jobs, and persists fingerprint/model
state only after successful indexing. `-- --force` replays all active jobs. A
different vector dimension requires a new dedicated index and complete replay;
existing mappings are not destructively replaced. The standard database bootstrap
adds a unique matching-state ID index and published/verified job scan index.

Configure a deployment scheduler to run this command and monitor sanitized exit
status. It is not automatically installed as a daemon or scheduler. Use one
deployment instance. Embedding/indexing calls happen outside Mongo transactions;
idempotent upserts support replay after a crash. MongoDB remains authoritative
while the index is eventually consistent. Back up/retain operational policies
using the existing database controls.

Ranking is recalculated per request to avoid stale profile/consent decisions.
Precomputed `jobMatches`, durable event-triggered refresh workers, performance
benchmarks at enterprise volume and stable snapshot pagination are not included.
Offsets address a bounded candidate pool that can change when jobs/profiles or
policies change. Production recall/latency require real index configuration,
scheduled synchronization, representative corpus evaluation and weight tuning.

Run `npm run test:matching`, `npm test`, `npm run typecheck`, `npm run build`.
Mongo tests create an isolated local replica set named `architecture_test`; they
do not load `.env` or access production data. No live provider readiness can be
claimed until an actual configured OpenSearch/embedding deployment is exercised.

## Validation performed (2026-09-12)

- Full backend suite: 68 passed, 0 failed, including authenticated matching APIs,
  provider contract tests and isolated MongoDB matching persistence/index tests.
- Backend TypeScript check and production TypeScript build passed.
- No backend lint script is configured.
- All matching provider configuration variables were absent in the local backend
  environment. Live OpenSearch and embedding requests were therefore not run.
- Frontend files changed: 0. Configured-secret scan across changed files: no
  matches. No `.env` edits, commits, pushes or production data changes performed.
