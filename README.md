# SkillonIT Employment — current frontend + shared backend

This branch builds on the existing frontend/shared-backend integration at `4f8253c` and adds a scheduled job hunting engine. Google authentication configuration and the existing website design are preserved. Feed cards show truthful missing-field labels and source attribution; public syndicated listings link to their original source.

See [Job hunting engine setup, sources and limits](docs/JOB_ENGINE.md). Start with `npm run jobs:seed`, `npm run jobs:once`, then `npm run worker:jobs` from `backend/` after installing dependencies and building. Source state is available through `npm run jobs:status`.

[Worldwide source audit and integration backlog](docs/GLOBAL_JOB_COVERAGE.md) distinguishes live feeds from credential-gated connectors and unconnected platforms. `npm run jobs:coverage` reports real inventory across 250 country/territory filters (ISO entries plus Kosovo); empty countries are explicitly reported. The preview is not a global public deployment.

For scheduled country discovery, run `npm run jobs:seed-worldwide` after the backend build, then `npm run worker:jobs`. This enables bounded daily Himalayas country queries, a separate worldwide query and Remote OK. It does not enable restricted marketplaces or guarantee local vacancies in every country. See the audit snapshot for attempted country queries and actual inventory.

```text
skillonit-employment/
  frontend/     Next.js pages, components, assets and API presentation
  backend/      Existing Express, MongoDB, auth and Module 2 code
  scripts/      Integration verification
  docs/         Backend contracts and operations
```

## Install

Use Node.js 22.17 or later and npm.

```sh
git clone --branch codex/job-hunting-engine https://github.com/Rupali28802/skillonit-employment.git
cd skillonit-employment
cd backend
npm ci
cd ../frontend
npm ci
```

Both applications install and build independently. No `.env`, credentials, uploads, database data or `node_modules` are committed.

## Configure locally

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env.local`. Keep the backend owner's existing credentials private. For normal MongoDB development use `DEMO_MODE=false`.

Backend settings:

```dotenv
HOST=127.0.0.1
PORT=4100
APP_URL=http://localhost:3000
DEMO_MODE=false
MONGODB_URI=<set privately>
MONGODB_DATABASE=Skillonitemployment
```

Frontend settings:

```dotenv
BACKEND_URL=http://127.0.0.1:4100
APP_URL=http://localhost:3000
DEMO_MODE=false
```

Use the same APP_URL in both applications. BACKEND_URL must point to Express directly, not back to the public frontend. The `/api/*` Next.js rewrite preserves the backend's cookies, status codes and error envelope. Business rules and persistence remain in Express.

## Run

In one terminal:

```sh
cd backend
npm run build
npm start
```

In a second terminal:

```sh
cd frontend
npm run build
npm start
```

Frontend: `http://localhost:3000`. Backend health: `http://127.0.0.1:4100/api/v1/health`.

Use `npm run dev` in each directory for development. Restart after environment changes. Build the frontend again when changing BACKEND_URL or APP_URL. Stop a running production frontend before rebuilding its `.next` directory.

## Existing Google sign-in

The frontend opens the backend's original `/api/v1/auth/google` endpoint directly. It does not depend on `/google/status`, create an OAuth client, exchange tokens, or change the backend Google flow. Successful Google callbacks still return to `/`, displaying the current frontend on the same public origin.

The existing backend requires HTTPS for Google OAuth:

1. Serve this frontend through your existing HTTPS domain/tunnel, pointing to frontend port 3000.
2. Set APP_URL in both local environment files to that public origin.
3. Keep GOOGLE_CALLBACK_URL in the backend and the existing Google client's Authorized redirect URIs equal to `https://YOUR-PUBLIC-HOST/api/v1/auth/google/callback`.
4. Restart the backend and rebuild/restart the frontend. Enter through the public URL for authentication.

When APP_URL is HTTPS, browser HTML requests to localhost redirect to that configured public origin. This keeps the backend's unchanged Origin checks, secure cookies and Google state cookie on one host. Direct server-to-server `/api` requests still use BACKEND_URL.

A dead temporary tunnel cannot be fixed by a frontend code change. If a quick tunnel hostname changes, update the existing callback configuration; do not create duplicate OAuth clients. Live Google consent cannot pass while Google's registered callback differs from the live public host.

## Existing profile and preferences forms

The frontend reads the latest profile/preferences revision and supplies expectedRevision when saving. Repeated saves advance the revision, stale saves show the backend conflict message, omitted extended preferences remain owned by the backend, and profile edits preserve existing employment history. Unknown experience remains null instead of silently becoming zero. Email verification redirects to the correct account workspace.

## Backend capabilities and limits

The published backend exposes Module 2 CV/onboarding/catalog/automation APIs. Their full contracts and required storage/scanner/parser/Redis policies are in `docs/backend/02-production-hardening.md`. This integration preserves the existing pages; it does not invent a new onboarding or CV management interface. The CV page continues to offer manual profile entry.

This backend does **not** implement `/me/profile-image/*` or `/me/profile-appearance`, and its Google identity handler does not store Google's profile picture. The existing sidebar and navigation design are retained, with initials/profession fallback. Photo/theme actions report the unsupported capability. No upload is falsely reported as saved. Implementing those services would require a separate backend task.

Before setting backend NODE_ENV=production, follow its existing Module 2 production checks and configure the required managed catalogs, completion policies and providers. Dependencies alone do not configure these services.

## Verify

```sh
cd backend
npm run build
npm run test:module2
node --import tsx ../scripts/test-frontend-integration.mts
cd ../frontend
npm run typecheck
npm run lint
npm run build
cd ..
node scripts/scan-secrets.mjs
```

The frontend integration check starts an isolated MongoDB replica set, Express on 3101 and Next.js on 3100. It does not load private environment files or use the real database. It verifies current hero rendering, auth/session routing, authenticated pages, profile revision conflicts, preference persistence, CV metadata, unsupported photo routes and the original Google PKCE redirect. It does not perform live Google consent or send real mail.
