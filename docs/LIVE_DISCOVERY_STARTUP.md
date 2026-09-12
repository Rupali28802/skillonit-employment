# Continuous discovery and new-job alerts

The backend's `npm start` (compiled production code) and `npm run dev` (TypeScript development) now start both the API and the discovery worker. The supervisor restarts either child after 15 seconds if it exits unexpectedly. Stopping the supervisor stops its children. `npm run start:api` remains available for deployments that supervise the worker separately with `npm run worker:jobs`.

The worker continuously checks which approved sources are due, including their individual cadence, quotas and provider backoffs. Its existing MongoDB lease prevents concurrent workers importing the same cycle. It does not re-date existing vacancies or bypass source restrictions to increase the counter.

The website polls discovery statistics every 15 seconds. “Detected today (UTC)” counts active published non-demo jobs first discovered since midnight UTC. It can correctly be zero before a successful import of new listings. The floating alert counts new active vacancies since this page's initial successful statistics response or the last acknowledgement. It works on all result pages and filter states. Clicking “View new jobs” clears filters and returns to page one sorted by discovery time. Counts come from MongoDB, not demonstration numbers.

This local setup runs while the backend process and computer remain running with internet access. It cannot fetch while the computer is shut down or asleep. Unattended 24/7 availability still requires the previously pending always-on hosting deployment; no production deployment is implied by this change.

## Automatic semantic indexing and worker health

Startup also supervises the semantic indexing worker. It checks for up to 100 new or changed public vacancies each pass, waits 30 seconds, and retries model/index failures without publishing fabricated results. Meaning-based search remains opt-in and covers indexed public vacancies; the keyword search remains available.

The discovery worker records a MongoDB heartbeat each cycle. The public statistics endpoint reports workerOnline and workerLastSeenAt; the interface warns when discovery is offline even if the API stream is connected. Country coverage is recomputed after import cycles and represents explicit geography plus source-reported eligibility. The supported ISO country/territory inventory contains 250 entries; additional source connections must have independently confirmed access and display rights.

Validation on 12 September: 300 enabled approved source configurations across 12 feed types, 2,355 active listings first discovered today (UTC), discovery worker online. This is a point-in-time observation, not a guaranteed daily volume or full worldwide platform coverage.

## Rotating live feed

The discovery UI uses a 3D carousel with one interactive front job and two decorative depth layers. Cards advance every six seconds while the page is visible; hover, keyboard focus, the pause control and reduced-motion settings stop automatic rotation. Previous/next controls allow manual browsing. Back layers are inert and hidden from accessibility navigation. The existing page controls still access the complete search result set.

Worker heartbeat writes occur every 30 seconds, including during long source import cycles, rather than only at cycle boundaries. Results refresh through SSE with a 30-second visible-page fallback. An unchanged total is valid when a permitted refresh finds no new unique matching vacancies or when jobs expire. Counters must never be incremented merely to simulate activity.
