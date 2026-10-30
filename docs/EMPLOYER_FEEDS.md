# Public employer job feeds

From backend/: run `npm install`, `npm run build`, then `npm run jobs:seed-employers` and `npm run worker:jobs`. MongoDB must be configured privately in backend/.env. Existing source settings are preserved on repeated seeding. The versioned configuration contains public board identifiers only.

The reviewed manifest now contains 11 public employer boards: Razorpay Software Private Limited, TechGrove by Banyan Software, Blenheim Chalcot India, NICE, SuperApp, Cognite (Greenhouse); Employ (Lever); and Ema, Handshake, LG Ad Solutions, Cartesia (Ashby). The additional boards were checked on 2026-10-14 for a live public endpoint and returned India-located opportunities at that time. This is a staged configuration, not proof that they are already present in the production database.

Each source preserves the employer-owned listing/application URL, is deduplicated across sources, and closes listings only after a complete source snapshot no longer contains them. A worker should refresh the boards at their configured cadence and enforce provider backoff. A source returning a failed or partial response must not remove listings.

Before the manifest can be seeded, restore the database write/index capacity described in [INDIA_COVERAGE_LIVE_AUDIT.md](INDIA_COVERAGE_LIVE_AUDIT.md). Then run `npm run jobs:seed-employers`, followed by `npm run jobs:once`, and review `npm run jobs:coverage`. Existing source settings are deliberately preserved, so each board can be rolled out and measured independently.

Official API references:
- https://docs.greenhouse.io/job-board.html
- https://github.com/lever/postings-api
- https://developers.ashbyhq.com/docs/public-job-posting-api

See JOB_SOURCE_MASTER_AUDIT.html for the broader outstanding source inventory.
