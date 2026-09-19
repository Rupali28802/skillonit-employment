# Observability and incident response

The backend writes one-line structured JSON to stdout. Central log collection must preserve `correlationId`, `event`, status, route group and duration while retaining the backend's field allowlist. Never enable request-body, cookie, authorization-header, OAuth-token or CV-content capture in the collector.

`GET /api/v1/admin/observability` is restricted to active administrators. It reports bounded process request metrics, queue lag/retries/dead letters, provider configuration health, recent anonymous incident counts and active alert conditions. Incident signals contain no user, IP, email, request body, provider response, CV text or credential data and expire through MongoDB TTL.

Production deployment must set the exact trusted reverse-proxy hop count with `TRUST_PROXY_HOPS`; keep it `0` when the API is directly reachable. Alert on `DEAD_LETTERS_PENDING`, `QUEUE_LAG_HIGH` and `API_5XX_SPIKE`. For an incident: pause the affected worker/provider, retain correlation IDs and audit records, revoke exposed sessions or provider grants, rotate affected secrets in the secret manager, restore from a tested backup when required, and record timeline, scope, containment, recovery and follow-up actions. Do not replay failed deliveries until ownership and idempotency are verified.

Use `/api/v1/health/live` only to detect a running process and `/api/v1/health/ready` to remove an instance when persistence is unavailable. The private `/internal/metrics` endpoint requires `OBSERVABILITY_METRICS_TOKEN`; never place that token in a URL, log, dashboard definition or repository. The public health response intentionally omits provider configuration.
