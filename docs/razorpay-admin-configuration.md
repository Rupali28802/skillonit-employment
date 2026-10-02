# Admin-managed Razorpay configuration

## Integration and access

Admin → Payments → Razorpay Configuration uses the existing billing provider, orders,
subscriptions, refunds, HMAC verification, webhook processing and entitlement updates.
No separate checkout or payment ledger was introduced.

The existing `payments.read` and `configuration.read` permissions are required for
metadata/history. Mutations require `payments.read` and `configuration.update`.
All checks run on the backend against the current admin assignment. The existing
session, same-origin and request rate-limit protections continue to apply.

Routes under `/api/v1/admin/payments/razorpay/`:

- `GET config?environment=test|live`: masked metadata only.
- `POST config`: validate and save encrypted credentials without activating them.
- `POST validate`: validate the saved credentials.
- `POST enable`: revalidate and atomically activate the selected saved version.
- `POST disable`: disable new checkouts globally, without deleting history.
- `GET history`: the latest 30 configuration audit events.

Every mutation requires `environment`, `expectedRevision`, a reason and explicit
confirmation. Changes targeting LIVE, or affecting currently active LIVE credentials,
also require `liveConfirmed`. Public checkout cannot select an environment.

## Storage and migration

Provision `PAYMENT_CONFIG_ENCRYPTION_KEY` through the deployment's protected secret
configuration before using the settings page. It must be 32 random bytes encoded as
64 hexadecimal characters. It is independent of Gmail encryption keys. Do not put its
value in source control, frontend variables, logs or this document. Retain it securely
with database backups: replacing or losing it prevents decryption. Key rotation needs
a separately reviewed decrypt/re-encrypt migration, not an environment-only replacement.

The existing AES-256-GCM utility encrypts Key Secret and the separate webhook signing
secret with independent random IVs. `systemConfig/razorpay-config` stores a revision,
environment slots and one active-version pointer. Immutable encrypted version records
also live in `systemConfig`. Existing repository transactions and ID uniqueness prevent
concurrent replacements; stale revisions receive 409. The normal configuration API
does not expose these records. Audit events contain only actor, action, environment,
timestamp, outcome and a reason with known credential values redacted.

Until a managed record exists, the existing `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
and `RAZORPAY_WEBHOOK_SECRET` remain the bootstrap source. On the first successful
managed save, existing environment credentials are encrypted and retained as the
legacy version. They remain active until explicit activation of the new credentials.
A failed initial save does not disable an existing environment configuration.
After a managed record exists, environment variables cannot override or silently
reactivate it. Keep the legacy environment values in place during initial rollout;
remove them only after the encrypted legacy snapshot and historical-payment checks
have been verified. Do not rotate the old credentials before capturing that snapshot.

Saving validates using authenticated `GET /v1/payments?count=1`. No charge is made.
Raw provider responses/errors are not returned or logged. Network/provider failures
leave the previous active version intact. “Connected” confirms API credentials only;
webhook delivery and bank/payment-method readiness require a real integration check.
The webhook secret cannot be verified using that API operation.

## Existing and new payments

New orders and recurring subscriptions store their credential version. Checkout returns
only the public Key ID. Existing order verification, refunds, reconciliation and
subscription cancellation load the stored version, even when new checkout is disabled.
Pre-migration records use the encrypted legacy snapshot. Signed webhooks continue
processing while disabled, using activated versions, with known records bound to their
stored TEST/LIVE environment. Saved but never activated credentials cannot sign events.
The Key Secret is never substituted for the webhook secret.

Pending checkout requests from a different credential version receive 409 and must
be restarted with a new idempotency key. After activating a new version, sync the
existing recurring plans through the existing Admin plan-sync action before offering
new recurring checkout. A plan linked to different credentials is rejected rather than
used in the wrong environment. Existing recurring events use their saved plan snapshot.

Retained credentials must remain valid at Razorpay for refunds/cancellations that still
need them. Do not revoke old API keys or discard old webhook secrets until outstanding
orders, subscriptions, refunds and webhook retries are reconciled. Changing merchants
requires explicit migration of subscriptions; changing a key does not migrate merchant
ownership. Removing encrypted historical versions is deliberately not part of this UI.

## Production activation checklist

1. Back up the database and securely preserve the encryption key.
2. Deploy the reviewed code with the dedicated encryption key on every API instance.
3. Open the settings using an authorized admin. Save real TEST credentials and a
   separate TEST webhook secret. No production credentials are populated by code/tests.
4. Activate TEST; sync recurring plans if used. Verify checkout, capture webhook,
   duplicate delivery, entitlements, refund and cancellation using Razorpay TEST mode.
5. Configure Razorpay's production webhook URL `/api/v1/webhooks/razorpay`, subscribed
   to the existing application's payment/subscription/refund events, with the matching
   separate signing secret. Confirm delivery in the Razorpay dashboard.
6. Save real LIVE credentials, explicitly confirm LIVE activation, sync LIVE recurring
   plans and perform an authorized real payment/refund validation.
7. Check old pending payments and subscriptions before retiring any legacy credentials.

This implementation does not deploy, change live settings, charge users, or replace
the encryption key. Automated tests use isolated database/provider-contract fixtures;
they cannot certify actual merchant credentials, webhook delivery or settlement.

## Implementation verification — 30 September 2026

- Backend full suite: 214 passed, 0 failed.
- Focused Razorpay/payment/recurring/Admin regression suite: 18 passed, 0 failed.
- Backend TypeScript and production build: passed.
- Frontend TypeScript, lint and production build: passed.
- Scoped credential-literal/private-key scan: no findings. Password fields are not
  stored in React state, local/session storage, URLs or client telemetry.
- Local browser verification: not performed; frontend startup was rejected with
  “blocked by policy”. No alternative launch method was used to bypass that rejection.
- Real Razorpay TEST/LIVE merchant validation and deployment remain pending. No live
  settings, payments, infrastructure, Atlas workers, commits or pushes were changed.

Task files: `backend/src/lib/razorpay-configuration.ts`, `backend/src/lib/providers.ts`,
`backend/src/lib/payment-billing.ts`, `backend/src/lib/recurring-billing.ts`,
`backend/src/lib/domain.ts`, `backend/src/lib/student-entitlements.ts`,
`backend/src/lib/store.ts`, `backend/src/api.ts`, `backend/.env.example`,
`backend/tests/razorpay-configuration.test.ts`,
`frontend/components/razorpay-configuration.tsx`,
`frontend/components/razorpay-configuration.module.css`,
`frontend/components/workspace.tsx`, and this document. Pre-existing changes in shared
files were retained.

## AWS release — 30 September 2026

The payment-only release is now deployed to `https://employment.skillonit.com`.
It was assembled against the actual AWS source, retaining unrelated Employer,
application-routing and worker code. Eleven source/UI files and their eight compiled
backend modules were installed. Both builds passed on AWS; the exact release also
passed its ten isolated configuration/billing checks.

`PAYMENT_CONFIG_ENCRYPTION_KEY` was generated on the server, stored in the protected
backend environment file, and never printed or copied to the local machine. The
Razorpay Key ID, Key Secret and webhook secret were absent and remain unconfigured.
No test/demo merchant credentials were installed. No payment was made or activated.

The API and frontend services were restarted. No discovery/matching workers, Atlas
access, DNS, database business records or other AWS projects were changed.
Rollback source/compiled files and the protected previous environment are at
`/home/ubuntu/skillonit-releases/razorpay-20260930/rollback`; the previous frontend
build remains at `/home/ubuntu/skillonit-employment/frontend/.next.razorpay-previous`.
Retain the new encryption key even if rolling code back, to preserve any future saved
configuration. The release manifest and deployment record are in the release directory.

Live checks: health/live, health/ready, public plans, pricing and login returned 200;
unauthenticated configuration access returned 401. The existing signed-in Admin
session displayed the new settings, `not configured`, disabled activation controls,
and the explicit LIVE confirmation. The browser was returned to TEST. The in-app
browser's pointer action did not toggle its native disclosure; keyboard Space did.

Remaining: enter real TEST credentials and a separate webhook signing secret in the
Admin form, validate/save/activate, configure Razorpay webhook delivery, then complete
TEST checkout/capture/refund/subscription verification before any LIVE activation.
No Git commit or push was performed.
