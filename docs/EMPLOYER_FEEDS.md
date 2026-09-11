# Public employer job feeds

From backend/: run `npm install`, `npm run build`, then `npm run jobs:seed-employers` and `npm run worker:jobs`. MongoDB must be configured privately in backend/.env. Existing source settings are preserved on repeated seeding. The versioned configuration contains public board identifiers only.

Three boards: Razorpay Software Private Limited (Greenhouse), Employ (Lever), Ema (Ashby). Each refreshes daily through existing validation, deduplication and expiry logic. Initial ingest published 47 jobs. Ashby returned 44 candidates, of which 22 were rejected by normal validation. Do not equate these three boards with complete ATS coverage.

Official API references:
- https://docs.greenhouse.io/job-board.html
- https://github.com/lever/postings-api
- https://developers.ashbyhq.com/docs/public-job-posting-api

See JOB_SOURCE_MASTER_AUDIT.html for the broader outstanding source inventory.
