# Operations and release requirements

## Environment separation

Use isolated development, staging and production MongoDB/Redis/provider accounts. Keep `DEMO_MODE=false` outside local demonstrations. Production registration currently fails closed until verified transactional email is implemented. Demo admin sessions must never be offered on a public deployment.

Set APP_URL to the exact trusted HTTPS origin. Proxy configuration must strip client-supplied forwarding/IP headers and apply ingress rate controls. Review secure-cookie behavior under TLS termination. Add a tested CSP and HSTS policy for the final origin before launch.

## Data and workers

MongoDB transactions require replica-set support. `backend/src/lib/store.ts` exports `bootstrapIndexes`; backend startup runs it after secrets are injected, before accepting traffic. Add indexes and pagination for every production query pattern. The demo `backend/.data` file is single-process test storage and has no production HA/backup guarantees.

`backend/src/workers/index.ts` includes source staging, retention and dedupe primitives; build with `npm run build` and run with `npm run worker` in `backend/`. It does not implement the complete worker catalogue. Add a scheduled producer, job IDs for idempotency, bounded retry/backoff, dead-letter handling, source cooldowns, heartbeat metrics and shared pub/sub before enabling. Never run applications through unverified destinations or unavailable sender providers.

## Release and rollback

Run type checking, lint, domain tests, API integration tests, build and dependency/secret scans. Then complete Chrome desktop, mobile, keyboard, focus, form-error and 200% zoom tests. Validate production MongoDB transactions and indexes against staging data. Validate provider failure paths, webhook replay, OAuth revocation, expiry, privacy export/delete and snapshot isolation.

Record a deployment image digest and previous known-good release. Deploy a canary, check health and error budgets, then expand. Roll back the image when latency, error rate or integrity checks regress. Schema changes must remain backward-compatible with the rollback release.

## Backup and incidents

Set business-approved RPO/RTO before launch. Use encrypted MongoDB backups and private object-storage lifecycle policies; restore into an isolated staging environment and record measured recovery time. Do not claim backup readiness until that drill passes. Rotate affected secrets and revoke sessions if credentials are exposed. For incorrect delivery, stop the sender queue immediately, preserve provider IDs and audit history, and investigate before replaying any message.

## Capacity acceptance

The original specification requires progressive datasets of 100k, 500k, 1M, 2M and 5M users with 1k, 5k, 10k, 25k and 50k+ concurrent-user targets. Build workload models from real query mixes, run 30–60 minute sustained load, multi-hour soak, spike and failure tests, and record p95/p99 latency, errors, queue lag, database pressure and costs. No capacity stage has been executed in this local environment.

## Primary implementation references

- Next.js routing and deployment: https://nextjs.org/docs/app/getting-started
- MongoDB transactions: https://www.mongodb.com/docs/drivers/node/current/crud/transactions/
- Razorpay signature verification and duplicate event IDs: https://razorpay.com/docs/webhooks/validate-test/
- Greenhouse public board API: https://developers.greenhouse.io/job-board.html

Read installed Next.js documentation before future edits, as required by the generated `frontend/AGENTS.md`.
