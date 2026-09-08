# Connect the existing backend to Atlas and SMTP

## Current verified status

The Atlas browser session was signed out during setup. Local backend configuration contains only explicit demo settings; `MONGODB_URI` and SMTP credentials are absent. No Atlas database, network access rule, user password or SMTP account was changed. No external connection or inbox delivery is claimed.

## Atlas: actions in your own browser

1. Sign in to the existing Atlas account (`skillonitemployment@gmail.com`). An Atlas account is not the application's database user.
2. Select the existing organization, project and cluster; do not create a replacement project or drop any database.
3. Under Database Access, select or create an application database user scoped to the SkillOnIT database. Enter its password yourself in Atlas. Do not send it to ChatGPT. Ensure its permissions cover application CRUD, transactions and required index creation.
4. Under Network Access, allow this development machine's current public IP (prefer a temporary single-IP entry). Do not enable unrestricted `0.0.0.0/0` access.
5. On the cluster, choose Connect → Drivers → Node.js. Obtain the application's connection string, and enter/URL-encode the database user's password locally, never in chat.
6. Place the URI in ignored `backend/.env` as `MONGODB_URI`. Set `MONGODB_DATABASE=skillonit` (or the chosen existing database name). Creating a database in Atlas is optional before first use: authenticated writes/index bootstrap can create collections when permissions allow. Do not insert sample data into an existing real database.
7. Run `npm run db:check` in backend. This is a read-only ping/topology check; it does not create/drop collections. Startup subsequently checks transaction-capable topology and creates required indexes idempotently. Existing incompatible indexes cause safe failure, not destructive replacement.
8. Use `DEMO_MODE=false` when connecting real candidate data. With a configured URI, connection failures never fall back to JSON. Keep the current demo preview until the intended target and credentials are ready.

Official reference: [Atlas driver connection](https://www.mongodb.com/docs/atlas/driver-connection/).

## SMTP: exact existing variables

In the same ignored local file, configure:

```dotenv
ENABLE_AUTH_EMAIL=true
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
AUTH_EMAIL_FROM=
APP_URL=
```

Fill these locally from the chosen SMTP provider; do not paste credentials into chat. Ports 465 (implicit TLS) and 587 (required STARTTLS) are supported. `AUTH_EMAIL_FROM` must be an authorized sender, and `APP_URL` must be the public HTTPS origin for email links. A signed-in Gmail browser session does not supply SMTP credentials. Do not put a normal Gmail login password into SMTP settings; use provider-approved SMTP authentication.

The adapter supports registration verification, resend verification and password recovery. It does not yet send password-change notification emails. Missing configuration fails closed for production registration/recovery; production responses exclude test tokens. SMTP mock tests prove message formatting/error handling only. A controlled real delivery test, sender-domain configuration and inbox receipt still need validation. Durable automatic email retries are not implemented.

## Demo deployment restriction

Demo mode exposes synthetic-account verification/reset tokens by design. The backend rejects it with `NODE_ENV=production`, a non-loopback HOST, or a non-loopback APP_URL. This does not detect a public reverse proxy or tunnel in front of a loopback process: never publish a demo server. Do not call demo mode production-safe.

## Validation and isolation

- `npm test`: unit/security/API checks, including malformed-URI log redaction and demo configuration rejection.
- `npm run test:mongo`: creates its own MongoDB replica set and `architecture_test` database; never uses the user's Atlas URI or normal database. Covers indexes/TTL, repeated bootstrap, transactions, auth/app workflows, concurrent reset consumption and revocation.
- `npm run typecheck` and `npm run build`: backend TypeScript checks.
- Backend has no lint script; run the already-installed frontend Oxlint executable against backend/src and backend/tests.
- `node scripts/scan-secrets.mjs` plus manual staged diff review before commit.

`.env`, `.env.local` and `.env.*.local` are Git-ignored. Only `.env.example` is versioned, with placeholders. Startup and diagnostic failures intentionally withhold raw MongoDB driver messages, including malformed-URI constructor errors.
