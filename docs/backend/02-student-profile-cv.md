# Module 2 — Student profile and CV/resume

## Delivery step 1: profile foundation

Backend only. Existing Express authentication and MongoDB repository remain in use.
The canonical profile remains `users.profile` to preserve current matching and application contracts.

### API

- `GET /api/v1/me/profile`: unchanged profile response.
- `PUT /api/v1/me/profile`: unchanged required profile fields and response; accepts optional `expectedRevision` (non-negative integer).
- `GET /api/v1/me/profile/status`: authenticated student only; returns revision, updatedAt, confirmedAt, confirmed, completeness and missingFields in the existing data envelope.

Read the status revision before saving and include it as `expectedRevision` to reject stale edits with `409 PROFILE_CONFLICT`. Existing clients omitting it retain last-write-wins behavior.
All ownership comes from the authenticated user, never a request userId.
Writes recheck account existence, student role and disabled status inside the transaction.

### Persistence and confirmation

Optional user metadata: `profileRevision`, `profileUpdatedAt`, `profileConfirmedAt`.
Legacy profiles begin at revision zero. No destructive migration or new indexes are required: access uses the existing unique user id index.
An explicit confirmed save records its timestamp; an unconfirmed save removes that timestamp.
Legacy confirmed profiles may have a null confirmation timestamp until the next confirmed save.
Completeness is a seven-field informational score, separate from confirmation and application eligibility. Zero years of experience is valid.
Profile changes preserve password credentials, Google identity, preferences, role and subscription fields. Audit records contain event identifiers only, not profile/CV text.

### Validation

`npm test` includes HTTP authentication/ownership, revision conflicts, concurrent edits, legacy revision handling, confirmation clearing, preserved credentials, validation, disabled accounts and role checks.
`npm run test:mongo` runs the same checks against an isolated real MongoDB replica set using `architecture_test`; it does not load production environment files.

## Onboarding and matching controls foundation

Source: Enterprise Master Specification v2.0, sections 7–9 and the supplied Module 2 brief.

| Method | API | Behavior |
| --- | --- | --- |
| GET/PUT | `/api/v1/me/onboarding` | Resume progress; save mode (`manual`/`cv`), mailbox skip and plan review. Optional expectedRevision prevents stale saves. |
| POST | `/api/v1/me/onboarding/complete` | Reject incomplete required steps; record completion without enabling automation. |
| GET/PUT | `/api/v1/me/preferences` | Existing contract plus skills, experience range, regions, India states, cities, salary, industries, employmentTypes, companyPreferences and automationConstraints. |
| GET/PUT | `/api/v1/me/consents` | Separate profile, automation and mailbox consent, with granted, policyVersion and server timestamp. Changes have append-only event records. |
| GET | `/api/v1/me/student-taxonomies` | Read configured roles/relatedRoleIds and industries from systemConfig id `student-taxonomies`; empty/unconfigured when absent. |

The 13 steps are account, basic profile, CV/manual, extraction review, skills, roles, locations, experience, salary/work mode, automation preferences, consent, optional mailbox, and plan review. Progress is calculated from saved facts, not a client-provided percentage. Profile/preferences endpoints save step data; onboarding stores flow choices and review state. The account requires verification; extraction review requires explicit profile confirmation. Mailbox connection is optional and unavailable until its provider is implemented. Plan review acknowledges the current plan; it does not purchase or activate a plan.

Onboarding completeness counts the 12 required steps; mailbox is excluded. The seven-field profile score is informational and separate. Zero experience and zero minimum salary are valid. A previously completed onboarding becomes incomplete if required facts/consent are later removed.

`automationConstraints` stores enabled intent, dailyCap, minimumMatch and excludedMethods. Enabling intent requires explicit automation consent. The existing execution field `automation` remains false; requesting true returns 503. Revocation disables both execution and stored intent. No jobs or applications are submitted by Module 2. Consent policy versions must correspond to policies actually displayed by the future UI; this backend does not generate legal policies. Mailbox and automation consents are separate.

## CV lifecycle

| Method | API | Behavior |
| --- | --- | --- |
| POST | `/api/v1/me/cv` | Raw PDF/DOCX body, Content-Type and X-File-Name headers; returns 202 queued metadata. Maximum 5 MB. |
| GET | `/api/v1/me/cv` | Own CV metadata only; never private object keys or binary data. |
| GET | `/api/v1/me/cv/:id` | Own metadata, extraction status and advisory draft. |
| POST | `/api/v1/me/cv/:id/confirm` | Explicit reviewed profile and confirmed=true, expectedRevision, expectedProfileRevision, name, targetRoles and summary. Creates a CV version and updates canonical profile atomically. |
| DELETE | `/api/v1/me/cv/:id` | Delete private object and related owned CV versions; retain canonical profile and historical application snapshots. Retry on storage failure. |
| GET/POST | `/api/v1/me/cv-versions` | Existing candidate-authored version API retained. |
| GET/DELETE | `/api/v1/me/cv-versions/:id` | Existing owned version API retained. |

States: uploading → queued → processing → review → confirmed. Failed storage/scanning/parsing becomes failed with a fixed error code. Deletion uses deleting state until storage deletion succeeds. Only confirmed review promotes facts; workers never write canonical profile data. Both CV and profile revision checks prevent stale/replayed confirmation. PDF/DOCX signature/extension validation is an initial check, not a malware scan.

Storage keys are server-generated. MongoDB stores filename, type, size, digest, owner, object reference, state, revision and advisory extracted fields, not the binary. Filenames cannot contain paths/control characters. CV contents and provider exception details are not logged. Document/version quotas use configured subscription limits and transaction serialization on the user record.

## Providers and workers

`CvObjectStorage`, `CvScanner` and `CvParser` are vendor-independent interfaces. Runtime `configuredCvProviders()` intentionally returns unavailable until audited adapters are supplied. `ENABLE_CV_UPLOADS=false` is the safe default. Setting the flag alone does not enable uploads. Test adapters exist only in the test harness; they are never runtime fallbacks.

The existing BullMQ worker accepts `cv-process` jobs and runs bounded batches from persistent cvDocuments queued/expired-processing states. Per-document leases prevent duplicate workers from publishing stale results. Provider work runs outside HTTP and database transactions. Configure a recurring cv-process job in the worker deployment once providers are wired.

## Collections and indexes

- Existing users: canonical profile, expanded preferences, profile revision/timestamps and cvQuotaRevision.
- studentOnboarding: unique id and userId.
- candidateConsents: unique id and compound userId/purpose.
- candidateConsentEvents: unique id; userId/updatedAt for event history.
- cvDocuments: unique id; userId/createdAt and status/leaseUntil indexes.
- Existing cvVersions: additional userId/documentId index.

All changes are additive. Production uses the existing configured database (Skillonitemployment); automated tests use architecture_test on an isolated MongoDB replica set and do not load production credentials.

## Validation and remaining blockers

Module 2 tests exercise real HTTP authentication and profile/preferences/onboarding routes, plus CV upload with test storage/scanner/parser adapters, ownership, deletion, versioning, failed scanning, confirmation/replay, consent history/revocation, completion and audit redaction. The same checks run in npm test and npm run test:mongo. These are not claims of real provider validation.

Remaining production work: configure private encrypted storage with lifecycle policy, real malware scanner and parser with timeout/resource/decompression limits; schedule the worker; implement operational recovery for interrupted uploading records and retention/cleanup; validate provider-backed deletion and upload/review end to end; configure taxonomies and published consent policies; run load/restore/security review. Frontend student routes and the onboarding UI are deferred pending clarification of the prior backend-only instruction. No frontend commands or edits were made for this backend delivery.

Module 2 is not production-ready while these provider and UI checks are incomplete.

## CV-first confirmation and ATS CVs

Both paths are backend-supported; no new frontend screens have been implemented.

CV-first: uploaded content is scanned then parsed into a full draft with empty strings/arrays and `experience: null` for unknown facts. No identity facts are borrowed from the account to fill missing extraction. `provenance` marks present extracted fields as `Extracted from CV`, absent fields as `Unknown`, and reviewed changes as `Candidate edited`. These labels identify origin, not proof that a parser is accurate. Real parser adapters must return only source-supported facts and be independently validated.

`POST /api/v1/me/cv/:id/confirm` accepts `{confirmed:true, expectedRevision, expectedProfileRevision, name, profile?:{...editedFields}}`. Omit profile to accept the displayed draft without re-entering it. Partial edits merge into the draft. Only this explicit confirmation writes the canonical profile. Revision conflicts reject stale review. Missing fields remain unknown even after confirmation; the account display name is preserved when profile name is unknown. Profile completeness still reports missing fields. Onboarding's basic-profile, skills and experience steps represent candidate review, not mandatory factual completeness; job preferences/consent remain separate.

Manual path: save candidate-supplied profile with `confirmed:true` using the existing profile API, then create an ATS draft. Generated drafts require a separate review/confirmation before export. Edits to a CV draft do not modify the canonical profile.

| Method | API | Behavior |
|---|---|---|
| POST | `/api/v1/me/ats-cv` | Create preview from confirmed profile; 201. |
| GET | `/api/v1/me/ats-cv/:id` | Owned draft, revision and plain-text preview. |
| PUT | `/api/v1/me/ats-cv/:id` | `{expectedRevision, profile:{...editedFields}}`; invalidate previous confirmation. |
| POST | `/api/v1/me/ats-cv/:id/confirm` | `{expectedRevision, confirmed:true, name}`; save a new immutable content snapshot in cvVersions, subject to existing quota. |
| GET | `/api/v1/me/ats-cv/:id/export` | Confirmed draft only. JSON data envelope contains `filename`, `contentType`, `content`, `versionId` for TXT download. |

Rendering is deterministic from the reviewed profile snapshot. Standard Skills, Work Experience, Experience Summary and Education headings are emitted only for supplied content. No tables, text boxes or decorative layout. Structured employmentHistory supports title, employer, start/end (YYYY or YYYY-MM, end may be Present), and description; date precision is preserved rather than inferred. Unknown experience is omitted; explicit zero is retained. Editing and re-confirming saves a new version without overwriting an earlier snapshot. Version deletion continues through existing owned cvVersions APIs. ATS compatibility across every external system is not guaranteed; PDF/DOCX generation is not implemented.

Additional collection: `atsCvDrafts`, unique id and userId/createdAt index, maximum 20 drafts per candidate. Existing authentication, ownership checks, optimistic revisions, transaction boundaries and version quotas apply. No candidate CV content enters audit logs. Draft retention/cleanup remains deployment work.

Validation includes sparse extraction/unknown provenance, no canonical writes before review, confirmation without repeated input, unconfirmed-generation rejection, owned HTTP preview, edit isolation, explicit export confirmation, immutable versions and credential preservation. Tests run against both the local test store and isolated MongoDB replica set `architecture_test`; no production candidate data is touched.

## Production hardening follow-up
See [02-production-hardening.md](02-production-hardening.md). Production adapters and document structural validation are now implemented; live provider setup and end-to-end validation remain required.
