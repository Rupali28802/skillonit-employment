# SkillOnIT Employment

One repository, maintained on `main`: the existing frontend design and the Express/MongoDB Module 1 and Module 2 backend. The original specifications and backend contracts are in `docs/`.

```text
skillonit-employment/
  frontend/   Next.js pages, components, styles and public assets
  backend/    Express APIs, authentication, MongoDB, Module 2 and workers
  scripts/    Integration tests and credential scanning
  docs/       Requirements, API contracts and operations
```

## Install and configure

Use Node.js 22.17 or later. Run `npm ci` in both `backend` and `frontend`.
For a new checkout, copy `backend/.env.example` to `backend/.env` and
`frontend/.env.example` to `frontend/.env.local`. Preserve existing private environment files when upgrading.

For local email/password development, both applications must use the same public origin:

```dotenv
APP_URL=http://127.0.0.1:3000
```

Backend: `HOST=127.0.0.1`, `PORT=4100`, `MONGODB_DATABASE=Skillonitemployment`.
Configure `MONGODB_URI` privately. Keep the chosen `DEMO_MODE` value; tests never change the development environment files.
Frontend: `BACKEND_URL=http://127.0.0.1:4100`.

The frontend `/api/*` proxy forwards to Express. Credential validation, session creation, authorization and MongoDB persistence remain in the existing backend. Never set BACKEND_URL to the frontend itself.

## Run

Backend terminal:

```sh
cd backend
npm run build
npm start
```

Frontend terminal:

```sh
cd frontend
npm run build
npm run start -- --hostname=127.0.0.1 --port=3000
```

Frontend: `http://127.0.0.1:3000`. Backend health: `http://127.0.0.1:4100/api/v1/health`.
For development, use `npm run dev` in each directory. Restart after environment changes;
rebuild the frontend when APP_URL or BACKEND_URL changes. Stop a production frontend before rebuilding its `.next` directory.

## HTTPS and Google sign-in

Google OAuth and the real auth-email adapter require a trusted HTTPS APP_URL.
Expose only the frontend through the configured HTTPS domain/proxy. Keep Express and MongoDB private.

1. Set APP_URL in both applications to the same reachable HTTPS origin.
2. Set backend GOOGLE_CALLBACK_URL to that origin followed by `/api/v1/auth/google/callback`.
3. Add that exact callback to the existing Google OAuth client's Authorized redirect URIs.
4. Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET privately in the backend.
5. Restart Express and rebuild/restart Next.js, then enter through the public origin.

The frontend checks `/api/v1/auth/google/status` before starting the existing Express OAuth flow.
State, PKCE, nonce, account association and session handling remain server-side. Successful login and Google callbacks redirect to `/`; `/dashboard` remains separately available.

When APP_URL is HTTPS, localhost HTML requests redirect to that canonical origin so browser cookies and Origin checks use the same host. A terminated Quick Tunnel cannot serve its old callback. A reachable host and matching Google Console configuration are prerequisites for live Google testing; an authorization redirect alone does not prove successful login.

## Profile and Module 2 integration

Profile forms use the revision from the displayed user snapshot. Preferences follow the revision actually returned by the backend, including unchanged saves. Stale writes retain the backend's conflict protection. Profile edits preserve employment history and stored photo/theme metadata, and unknown experience remains null.

The existing private avatar/cover/logo and profile appearance APIs remain available. Images are validated, resized and stored by Express; authorization is unchanged.

Module 2 includes profile, completion, preferences, automation preferences, CV draft/confirmation/versioning, onboarding, consent and taxonomy APIs. Provider requirements and production gates are in `docs/backend/02-production-hardening.md`.
The current frontend does not yet expose every Module 2 operation: its CV page offers manual profile entry, and complete CV upload/review/versioning and onboarding UI coverage remain separate work. This integration preserves the supplied UI and does not claim those absent screens are complete.

Real CV services require the configured private storage, malware scanner, parser and worker/Redis infrastructure. Contact delivery, mailbox connections and commercial payments also require their existing provider configuration. Passing isolated tests is not proof of production provider readiness.

## Validate

```sh
cd backend
npm test
npm run test:mongo
npm run typecheck
npm run build
npm run test:frontend
cd ../frontend
npm run typecheck
npm run lint
cd ..
node scripts/scan-secrets.mjs
```

`test:frontend` builds Next.js into ignored `.next-integration`, starts an isolated MongoDB replica set using `architecture_test`, Express on 3101 and the production frontend on 3100. It does not connect to the configured Atlas database, send mail, or simulate successful Google consent. Ports 3100/3101 must be free. An initial run may download the MongoDB test binary. The separate build directory preserves any currently running `.next` build.

Never commit `.env`, `.env.local`, credentials, tokens, CV uploads, database dumps, `.data`, logs or generated builds. Only redacted `.env.example` templates belong in Git.
