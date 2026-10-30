# India Coverage Live Audit — 2026-10-09

This is a point-in-time, read-only measurement from the live `jobs`, `jobFeedSources`, and `jobFeedStates` collections. It is not a claim that SkillOnIT indexes all India jobs.

## Measured inventory

| Measure | Observed value |
| --- | ---: |
| Published live jobs | 34,288 |
| India-local jobs | 1,046 |
| India-eligible jobs (including remote/international eligibility) | 1,138 |
| India-local jobs with a recognized state | 3 (0.3%) |
| India-local jobs with a city | 1,046 (100%) |
| Official Indian regions represented | 1 of 36 (2.8%) |
| India listings seen in the last 24 hours | 0 |
| India listings seen in the last 7 days | 71 |
| India listings older than 7 days | 1,067 |

The reported state coverage reflects recognized official state/union-territory labels. A city alone is not treated as proof of a state, so this exposes a location-normalization and source-mix gap rather than inflating regional coverage.

## Feed health

The engine has 319 approved and enabled source configurations. At the measurement time, 251 were partial, 41 were failed, and no source had a recent successful run according to its configured cadence.

The failed-source categories were:

| Category | Count | Required action |
| --- | ---: | --- |
| `MISSING_JOOBLE_CREDENTIALS` | 39 | Obtain and configure authorized Jooble credentials and confirmed India redistribution scope. |
| `MISSING_USAJOBS_CREDENTIALS` | 1 | Configure the approved USAJOBS key and registered user-agent, if that source remains in scope. |
| `SOURCE_UNAVAILABLE` | 1 | Recheck the source provider and retain the failure until a successful authorized refresh. |

No direct-ATS records were present in the separate `jobSources` registry at this measurement; India listings currently come from the main engine's configured source records.

## Immediate operating constraints

MongoDB reads and `ping` are available. Atlas index bootstrap currently fails with a capacity-class error, so refresh and configuration commands that create indexes remain protected from running. The read-only `jobs:coverage` and `jobs:status` commands now remain available during this incident.

## Remediation order

1. Restore Atlas capacity before resuming ingestion, index bootstrap, or source configuration writes.
2. Keep the India regional metric at its measured 1-of-36 value until source-returned location data supports more regions.
3. Complete authorized Jooble access or disable unconfigured Jooble sources through a reviewed operational change; do not retry them as if credentials exist.
4. Add approved India employer ATS boards and government/partner feeds using the intake process in [INDIA_SOURCE_PARTNER_INTAKE.md](INDIA_SOURCE_PARTNER_INTAKE.md).
5. Run `npm run jobs:coverage` from `backend` after each reviewed source change and compare freshness, state coverage, and failure categories.
