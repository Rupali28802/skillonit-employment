# Production operations checklist

## Ingress and deployment

- Terminate TLS at the managed load balancer/CDN and redirect HTTP to HTTPS.
- Keep the backend origin private. Allow traffic only from the load balancer and operations network.
- Configure `TRUST_PROXY_HOPS` to the measured proxy chain; never use a blanket trust setting.
- Apply WAF managed rules, bot controls, per-IP edge limits and DDoS protection before origin traffic.
- Route liveness to `/api/v1/health/live` and readiness to `/api/v1/health/ready`.
- Run API and worker as separate services with at least two API instances across failure zones.
- Deploy immutable images, retain the previous image digest and use a canary before full rollout.

## Metrics, logs and alerts

- Store `OBSERVABILITY_METRICS_TOKEN` in the deployment secret manager and send it only as a Bearer header to `/internal/metrics` over the private network.
- Import `config/prometheus-alerts.yml` or translate the same conditions to the selected monitoring provider.
- Ingest JSON stdout without adding request bodies, headers, cookies, email addresses, tokens or CV contents.
- Alert operations on unavailable instances, API error spikes, queue lag, dead letters and provider failures.
- Restrict `/api/v1/admin/observability` to authorized administrators.

## Backup and recovery

- Enable encrypted continuous MongoDB backups and point-in-time recovery on the production cluster.
- Define RPO and RTO with the business owner before launch.
- Restore the latest backup into an isolated staging project; never overwrite production during a drill.
- Validate collection counts, indexes, authentication, ownership, audit history and representative Module 1/2 workflows.
- Record backup timestamp, restore start/end, measured RPO/RTO, validator, failures and corrective action.
- Confirm Google Drive CV retention/deletion and provider backup behavior separately from MongoDB metadata.

## Release gate

- Run `npm test`, `npm run test:mongo`, `npm run typecheck`, `npm run build`, dependency review and secret scan.
- Run sustained, spike and soak tests against staging with non-personal test data.
- Confirm alert delivery and perform one incident-response exercise.
- Confirm rollback restores the previous image without a database downgrade.
- Do not declare production readiness until the real WAF, monitoring, alert channel, backup restore and load tests are evidenced.
