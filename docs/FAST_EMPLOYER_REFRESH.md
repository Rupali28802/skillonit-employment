# Fast employer refresh

Connected public employer boards now default to a 10-minute interval. The schema also supports 5 minutes for reviewed public Ashby, Greenhouse and Lever boards. This is a polling target, not a guaranteed publication-to-display latency: source caches, network failures, provider throttling and time spent on other feeds can delay a run. The worker must remain running; a sleeping/offline local computer does not poll.

Existing installations, after building the backend:

```powershell
cd backend
node --env-file-if-exists=.env dist/job-engine/cli.js refresh-employers 10
npm run worker:jobs
```

Use 5 instead of 10 only for those reviewed boards when the higher request volume is appropriate. Configuration updates preserve failure cooldowns and running claims. They reschedule healthy completed feeds from their last success. The command preserves source identity, permission evidence and publication settings. Provider-level 429 backoff still applies. New jobs use the existing normalization, duplicate detection, review and publishing pipeline.

Hourly/daily/restricted provider schedules are unchanged. No LinkedIn/Indeed/social webhook connection is implied. Official public-board documentation reviewed: https://docs.greenhouse.io/job-board.html, https://github.com/lever/postings-api, https://developers.ashbyhq.com/docs/public-job-posting-api. These document public retrieval; the 10-minute interval is our conservative operational choice, not an explicit provider SLA.

Coverage exports now include configured intervalMinutes and persisted nextRunAt for each source. Next-run timestamps are scheduling targets, not proof that an import succeeded; check lastSuccessAt, status and counts.
