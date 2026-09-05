# SkillonIT Employment

The existing website is separated into an independent Next.js frontend and Node.js/Express backend. Pages, components, styles, animations and browser workflows are preserved. The original specification and scope analysis remain in `docs/`.

The enterprise branch now also includes candidate saved searches/alerts, notifications, confirmed text CV versions, a guided search assistant, template history APIs, admin content/source/feature controls, transactional daily quotas and batched retention. See `docs/ENTERPRISE_UPDATE.md` for scope and validation. External-provider features remain explicitly unavailable where unfinished.

```text
skillonit-employment/
├── frontend/       Next.js UI, pages, assets and API data fetching
├── backend/        Express APIs, authentication, MongoDB, providers and workers
├── docs/           Original requirements, implementation status and operations
├── scripts/        Repository checks
├── README.md
└── .gitignore
```

## Clone and install

Use Node.js 22.17 or later and npm. Clone the selected implementation branch:

```sh
git clone --branch codex/enterprise-portal https://github.com/Rupali28802/skillonit-employment.git
cd skillonit-employment
cd backend
npm ci
cd ../frontend
npm ci
```

Each application has its own package manifest and lockfile. Neither needs the other application's source directory or dependencies to build or start.

## Backend — terminal 1

Copy `backend/.env.example` to `backend/.env`. For the existing local demo, set:

```dotenv
PORT=4000
HOST=127.0.0.1
APP_URL=http://localhost:3000
DEMO_MODE=true
```

Leave `MONGODB_URI` empty for fictional local demo storage, or set it privately to a MongoDB replica-set/Atlas connection string. The backend automatically connects and creates indexes before accepting traffic. MongoDB transactions require a replica set. MongoDB takes precedence over demo file storage when a URI is configured. Existing local demo records were moved to `backend/.data/`; they are never committed. Demo storage supports one backend process only.

```sh
cd backend
npm run dev
```

The API is at `http://localhost:4000/api/v1`. Check `http://localhost:4000/api/v1/health` independently of the frontend.

## Frontend — terminal 2

Copy `frontend/.env.example` to `frontend/.env.local`:

```dotenv
BACKEND_URL=http://127.0.0.1:4000
APP_URL=http://localhost:3000
DEMO_MODE=true
```

```sh
cd frontend
npm run dev
```

Open `http://localhost:3000`. Local candidate, employer and admin demo sessions work as before. The frontend contains no database driver, API handlers, credentials, authentication implementation or business-rule engine. Next.js renders the existing UI using Express API responses. Its `/api/*` rewrite forwards browser requests to Express, preserving same-origin HttpOnly session cookies and existing API URLs. This proxy is configuration only; all request handling is in the backend. Keep `BACKEND_URL` free of credentials. Restart/rebuild Next.js after changing it.

Use the exact frontend origin for backend `APP_URL`, including port. For separate hosts, route `/api` to Express at the frontend ingress or retain the Next.js rewrite. Do not embed service credentials in `NEXT_PUBLIC_*` variables. The backend also allows credentialed CORS for its exact configured `APP_URL`.

## Production builds

Run independently in each directory:

```sh
npm run build
npm start
```

Set `NODE_ENV=production`, `DEMO_MODE=false` and private backend environment variables. Expose HTTPS at the ingress; session cookies are Secure in production. Set backend `HOST=0.0.0.0` when using containers. MongoDB, Redis and payment credentials belong exclusively in backend environment variables or a secret manager. `npm run worker` in `backend/` runs the compiled existing worker and requires MongoDB plus Redis. Backend startup fails if neither MongoDB nor explicit demo mode is configured.

Frontend builds do not require a running database or backend. Dynamic pages require the backend at runtime. Both services must be running for the complete website.

## Validation

```sh
cd backend
npm run typecheck
npm run build
npm test
npm run test:mongo
npm run test:integration
npm run test:features
npm run test:architecture  # requires both services running
cd ../frontend
npm run typecheck
npm run lint
npm run build
cd ..
node scripts/scan-secrets.mjs
```

`test:integration` requires a local demo backend at port 4000. Set `TEST_URL=http://localhost:3000` to test through the frontend proxy. `TEST_ORIGIN` defaults to `http://localhost:3000`. Tests create clearly synthetic records. `test:mongo` starts an isolated real MongoDB replica set, exercises API workflows and rollback/index behavior, then removes its temporary database; it never loads your `.env`. The first run downloads a MongoDB test binary. GitHub Actions validates both builds, unit tests, MongoDB integration, and proxied API workflows.

## Existing implementation status

This architecture change preserves the existing implementation's capabilities and limits. Contact forms persist enquiries for admin review; outbound contact mail and mailbox OAuth were not connected before separation and remain unconfigured. CV processing, production registration/email delivery, automated sending and commercial payment activation retain their existing unavailable responses. No real emails, applications or payments are sent by tests. See `docs/IMPLEMENTATION_STATUS.md` for the original enterprise feature gaps; this refactor does not claim those features are complete.

Never commit `.env`, `.env.local`, `.data`, tokens, CVs, database dumps, or build output. Only `.env.example` templates belong in Git. See `docs/ARCHITECTURE_SEPARATION.md` for the migration inventory and verification record.

The historical `scripts/verify-ui-preservation.mjs` belongs to the earlier architecture-only refactor. It intentionally compares exact markup to that old revision and is no longer a CI gate for this user-authorized feature expansion. Integration, route transport, lint/typecheck, builds, MongoDB and feature regression checks remain active.

If default ports are occupied, use backend `PORT=4100`, backend/frontend `APP_URL=http://127.0.0.1:3100`, frontend `BACKEND_URL=http://127.0.0.1:4100`, and start the frontend with `npm run dev -- --port 3100`. For tests set `TEST_URL=http://127.0.0.1:4100` and `TEST_ORIGIN=http://127.0.0.1:3100`. The architecture suite also accepts `TEST_FRONTEND=http://127.0.0.1:3100`. Use matching origins; localhost and 127.0.0.1 are distinct.
