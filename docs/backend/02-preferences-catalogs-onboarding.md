# Module 2 backend configuration foundation

Source: Enterprise Master Specification sections 7–10 and 51, with the backend-only request. Existing CV draft/confirmation, ATS editing/versioning/TXT export and Module 1 authentication remain in place. No matching, discovery, application submission, mailbox OAuth or payment implementation is added.

## Files changed in this extension

New: backend/src/lib/student-preferences.ts; backend/src/lib/student-catalog.ts; backend/src/lib/profile-completion.ts; backend/src/configure-student-catalog.ts; backend/config/student-catalog.example.json; backend/tests/module2-foundation-checks.ts; backend/tests/module2-foundation.test.ts; this document.

Updated: backend/package.json; backend/src/api.ts; backend/src/app.ts; backend/src/student-module.ts; backend/src/lib/student-onboarding.ts; backend/src/lib/security.ts; backend/src/lib/store.ts; backend/tests/mongo-integration.ts.

No frontend files were modified in this extension. Pre-existing frontend worktree flags were left alone; git diff --numstat -- frontend remained empty. No secrets were added, .env remains ignored, and no commit or push was performed. Existing unrelated and prior Module 2 changes were preserved. Live services were not restarted for this extension; validation used isolated backend servers.

## API contracts

All paths below start with `/api/v1`. Requests use the existing opaque session and same-origin checks. Responses retain `{data, correlationId}`; errors retain `{error, correlationId}` and now include classification/retryable hints. IDs come from the authenticated session, never a supplied userId. Student endpoints require a student account. Catalog reads require authentication; configuration endpoints require admin.

| Method | Path | Contract |
|---|---|---|
| GET / PUT | `/me/preferences` | Existing fields retained; PUT merges explicitly supplied top-level fields only. Optional expectedRevision prevents stale writes. Arrays/nested objects are replaced when supplied, not merged element by element. GET adds revision. |
| GET / PUT | `/me/automation-preferences` | enabled, dailyCap, allowedRoleFamilies, excludedRoles, allowedLocations, excludedLocations, minimumSalary, workModes, employmentTypes, paused, schedule. Optional expectedRevision. Returns executionAvailable:false. |
| GET | `/taxonomy/occupations` | Active entries with aliases, relatedRoleIds and parentId. Query parentId (or root), after, limit (1–100). |
| GET | `/taxonomy/locations` | Active entries; query parentId (or root), countryCode, type, after, limit. |
| PUT | `/admin/student-catalog` | `{occupations:[], locations:[]}` validated merge by stable ID, up to 500 entries of each kind per batch. |
| GET / PUT | `/me/onboarding` | Resumable currentStep, profileCreationPath CV/MANUAL, existing mode cv/manual, planReviewed, mailboxSkipped. Optional expectedRevision. Conflicting path aliases rejected. |
| POST | `/me/onboarding/complete` | Server recomputes required steps inside a transaction; repeated completion retains revision/timestamp. |
| GET / PUT | `/me/consents` | Existing `{purpose, granted, policyVersion}` or `{consentType, status:'granted'|'revoked', version}`. Types: profile, automation, mailbox. Optional controlled source/context. No userId accepted. |
| GET | `/me/profile/completion` | percentage, completedFields, missingFields, ready, readinessStatus, configurationVersion. |
| PUT | `/admin/profile-completion` | `{version, requiredFields}` from supported profile field keys. |

Preferences include roles, relatedRoles, skills, experience min/max, experienceYearBands, countries, regions, indiaStates, cities, salary min/max/currency, modes, employmentTypes, industries, companyPreferences, exclusions and legacy automationConstraints. These are preferences, not canonical candidate facts. Empty collections are safe defaults. Optional experience/salary remain absent until supplied; absence does not become a fabricated candidate fact. Client consentAt cannot grant consent. Legacy `automation:true` remains unavailable.

Automation is configuration only. Defaults: disabled, paused, cap 5, empty filters and null salary/schedule. Caps are integers 0–100. Scheduling uses an IANA time zone, unique weekday numbers 0–6 and HH:mm start/end; overnight windows require future support and are rejected. Allowed role families and location references must exist and be active. Consent is required to enable. Revocation disables and pauses saved settings transactionally. No worker consumes these settings to submit applications.

## Collections, compatibility and indexes

New `studentPreferences` stores one record per user with revision/timestamps and validated preferences. On first access, old users.preferences is a fallback; the first successful write creates the separate record. Each write also updates users.preferences inside the same transaction to preserve existing consumers. Canonical users.profile is untouched. This is not a destructive migration.

New `automationPreferences` has one record per user. New `occupationFamilies` and `locations` hold configurable catalogs. Existing studentOnboarding, candidateConsents, candidateConsentEvents, auditLogs and systemConfig are reused.

Added indexes:

- All four new collections: unique id.
- studentPreferences and automationPreferences: unique userId.
- occupationFamilies: unique slug; parentId+active.
- locations: unique slug; unique countryCode+code; parentId+active; countryCode+type+active.

Existing studentOnboarding.userId unique is retained. Existing candidateConsents userId+purpose unique is retained because purpose is the migration-compatible alias of consentType; a redundant new index is unnecessary. Canonical profiles remain embedded one-to-one in the existing uniquely indexed users document; no duplicate studentProfiles collection or index is introduced. Index bootstrap is additive and idempotent. The default configured database is unchanged; tests use only architecture_test in an isolated replica set.

## Catalog configuration

Controllers contain no occupation or location lists. Catalog schema supports stable IDs, slugs, aliases, active status, related occupations, and parent/child links. Writes validate missing parents, cycles, duplicate slugs/IDs, aliases, related-role references, country/subdivision/city relationships and country-specific location codes. India state/union_territory entries use countryCode IN; worldwide country/region/state/province/city types are available. Lookups are paginated; inactive entries are omitted. Complete worldwide datasets are not bundled.

Use the admin endpoint, or explicitly run from backend:

```text
npm run catalog:configure -- path/to/reviewed-catalog.json
```

The CLI uses the existing environment and configured database, adds required indexes and merges records by stable ID without deleting unrelated entries. Review the database target before running it. `backend/config/student-catalog.example.json` is an illustrative subset, not an authoritative worldwide taxonomy. It is never automatically seeded. This task did not seed or change production data.

## Onboarding, consent and completion

currentStep is persisted for resume. completedSteps and onboardingStatus are calculated from authoritative profile/CV/preferences/consent state on each request; clients cannot claim completed steps. Creation path aliases are normalized. Repeating identical updates is a no-op. Completion has a server timestamp and lastUpdated; state changes cannot falsely mark missing facts complete. Basic CV/profile review remains distinct from factual profile completeness. The new automation settings can satisfy that review step without re-entering legacy settings.

Consent records include userId, consentType/purpose, version/policyVersion, status/granted, grantedAt, revokedAt, createdAt, updatedAt, source/context. The two consent types remain separate. Each effective transition appends a candidateConsentEvents record and safe audit action; identical retries do not create extra events. Legacy records expose unknown timestamps as null rather than inventing historical consent times. Source/context accept controlled enum labels, not arbitrary sensitive strings. Mailbox access itself is not implemented.

Completion uses systemConfig/profile-completion. Default required fields are name, headline, skills, experience, education, country and city. Admin configuration can select supported fields including employmentHistory. Unknown/blank values remain incomplete; explicit zero experience is valid. An unconfirmed profile scores zero even when an extraction draft looks complete. This reusable service supplements the existing profile/status contract without changing it.

## Audit, errors and validation

Module 2 audit actions carry actorId, action, entityType, entityId, timestamp, createdAt, correlationId and empty safe metadata. HTTP events use the same server-generated correlation ID as the response. Background/service events get a generated ID and can be traced by entity ID. No CV text, preference values, credential material or arbitrary metadata is logged. Legacy authentication audit records keep their original restricted schema. API rejection logs contain only correlationId, HTTP status and classification; provider exceptions remain redacted. Existing CV leases, confirmation gates and fixed provider-failure states are preserved.

New tests cover HTTP ownership/validation, partial updates preserving omitted values, preferences persistence, catalog hierarchy/aliases/related roles/conflicts, location relationships/lookups, resumable and retry-safe onboarding/completion, independent consents/revocation, automation caps/schedule/pause/reference validation, configuration-driven completeness, correlation/audit safety and password preservation. The same helper runs against isolated MongoDB; it additionally verifies new indexes and database-enforced owner uniqueness. Existing authentication/CV tests remain enabled.

Backend validation: npm test (24 passed), npm run test:mongo, npm run typecheck and npm run build. The separate legacy test:architecture targets live frontend demo pages; it returned 403 at demo login and is not a backend-only validation pass. No frontend or DEMO_MODE changes were made to bypass it.

Remaining backend deployment work: select/review and load production occupation/location datasets and completion/consent policies; configure real private CV storage/scanner/parser adapters, worker scheduling and retention/recovery policies; validate those real services and operational load/restore behavior. No claim of full Module 2 production readiness is made.

## Production hardening follow-up
See [02-production-hardening.md](02-production-hardening.md) for current provider adapters, stricter production validation, skills/catalog metadata, retries, retention and deployment requirements. This follow-up supersedes the earlier provider-unavailable implementation notes.
