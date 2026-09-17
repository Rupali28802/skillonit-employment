# Confirmed profile and CV matching foundation

`GET /api/v1/me/matches` returns the existing `{ data: [...jobs], correlationId }` envelope to the authenticated student. The student dashboard uses the same matcher. No user ID, profile, or CV supplied through query parameters overrides the session owner.

Matching reads the canonical user profile. CV drafts, raw documents and unconfirmed extractions are never inputs. The existing CV confirmation transaction promotes approved facts into that profile; manual confirmed profiles follow the same path. Explicitly unconfirmed field provenance is excluded. An unconfirmed profile returns no recommendations.

Each result retains `match.score` and `match.reasons`, and adds `version`, `status`, `matchedSkills`, `missingSkills`, `missingRequirements`, `unknowns`, `exclusions` and `breakdown`. Scores are deterministic evidence points, not hiring probabilities or permission to apply.

Weights: unique exact normalized skills 40, selected/related role (or confirmed headline/history title when no target roles exist) 25, listed experience range 15, explicit location preferences 10, explicit work arrangement 10. Empty preferences do not earn location/mode points. Unknown experience remains unknown. Skill wishes in preferences do not count as candidate qualifications. No inference from free-text descriptions or education is performed.

Explicit country/city/state, work arrangement, employment type, industry/category, company exclusions and comparable salary ranges constrain recommendations. Remote does not override a country restriction. Different salary currencies are reported as unknown; no exchange rate is invented. Managed occupation/location IDs are resolved to active catalog labels. Roles use phrase boundaries; skills use exact normalized equality, not substring matches or unverified synonyms.

Only verified, published, unexpired jobs discovered within the last 90 days are ranked. Future-dated jobs are excluded. Ties use discovery date, then ID. Existing plan-based company/contact visibility remains enforced by `publicJob`. No matching logs contain candidate facts, and this feature does not mutate profiles, CVs, sessions, jobs or applications.

## Current limits

- This is a rule-based backend foundation, not an embedding/LLM model or externally validated recruitment quality assessment.
- Both endpoints evaluate the existing repository limit of 1,000 published verified records. Matches returns 30 and dashboard returns four. Large-catalog retrieval/pagination remains future work.
- Job requirements must already be structured. No ingestion, resume parsing provider, email sending, automatic applications, frontend redesign or production data seeding is included.
- Free-text geographic labels are compared exactly after normalization. Hierarchy expansion and skill synonyms are not inferred. Different salary periods cannot be compared reliably until the job model captures them.
- Automated tests use isolated test fixtures; they do not establish live provider readiness or real candidate/job matching quality.
