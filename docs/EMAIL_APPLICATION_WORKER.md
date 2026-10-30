# Isolated email application sender

The production email sender runs separately from the shared database-backed operations worker. It polls only queued `email` applications through the existing application engine and Gmail Send integration. It does not schedule Auto Apply or consume CV, discovery, verification, notification, analytics, subscription, or retention tasks.

## Activation prerequisites

- PostgreSQL production connection and application indexes are healthy.
- Gmail Send OAuth client configuration and token-encryption key are available to the backend service account.
- The controlled candidate has a connected same-address Gmail mailbox with only `gmail.send`, a confirmed profile and CV, an approved template, and an eligible verified email job.
- The candidate's current plan and daily application allowance permit the confirmed manual send.
- `ENABLE_APPLICATION_ENGINE=true` is set for both the API and isolated sender only after the controlled test is ready.
- `APPLICATION_SENDER_POLL_MS` defaults to 60000 and is bounded to 5000–300000.
- `APPLICATION_SENDER_BATCH_SIZE` defaults to 10 and is bounded to 1–50.

The service command is `npm run worker:application-sender`. Do not start `npm run worker` for this rollout because that shared worker registers unrelated schedules based on their feature flags.

## Safe rollout

1. Keep candidate Auto Apply disabled and paused. Keep Free-plan Auto Apply disabled.
2. Build the backend and install the service definition without starting it.
3. Prepare one controlled, verified email job whose recipient is controlled by the operator.
4. Set `ENABLE_APPLICATION_ENGINE=true`, restart the API, and confirm health.
5. Start the isolated sender and inspect its systemd status and redacted logs.
6. Manually review and confirm the single application in the UI.
7. Verify `QUEUED → SENDING → SENT`, Gmail Sent, masked provider evidence, application history, entitlement usage, and audit events.
8. Repeat the same request and confirm no second application or email is created.
9. Exercise a pre-provider failure and confirm credits are released; do not force a post-provider timeout because uncertain sends intentionally require human review.

## Rollback

Stop and disable the isolated sender, restore `ENABLE_APPLICATION_ENGINE=inactive`, restart the API, and verify health. Do not retry records marked `MAIL_SEND_UNCERTAIN`; check Gmail Sent first. Existing `SENT` records and audit history remain immutable.
