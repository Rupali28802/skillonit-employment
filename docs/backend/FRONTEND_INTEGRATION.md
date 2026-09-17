# Shared frontend/backend integration

Backend source integrated from `codex/backend-foundation` commit `0c03281`. The existing homepage, job grid, hero, category carousel, navigation and professional profile UI are preserved. Profile media endpoints, storage indexes and image dependencies are retained alongside the shared backend.

## Run on either computer

1. Pull the integrated branch from this same repository. Install dependencies with `npm ci` separately in `backend` and `frontend`.
2. Configure `backend/.env` privately using `backend/.env.example`. Keep `DEMO_MODE=false`. The shared setup uses backend port `4100`.
3. Configure `frontend/.env.local` with `BACKEND_URL=http://127.0.0.1:4100`, `APP_URL` set to the actual public frontend URL, and `DEMO_MODE=false`.
4. Build and start both apps with `npm run build` then `npm start` in their respective directories. The frontend listens on `3000`.
5. On the computer hosting the public HTTPS tunnel, point the tunnel at the **frontend port 3000**, not the backend port. Its `/api` rewrite forwards to Express. The Google Console redirect URI, backend `GOOGLE_CALLBACK_URL` and backend `APP_URL` must all refer to this same live public frontend host.

Secrets and local databases are ignored by Git. Do not share `.env` through commits or issue comments. A temporary tunnel belongs to its running process; a different computer's quick tunnel generally receives a different hostname and needs an updated registered Google redirect URI.

## Authentication contract

- Password registration: `POST /api/v1/auth/register`; successful unverified registration opens `/verify-email` and sends `{ email, otp }` to `POST /api/v1/auth/verify-email`. Resend uses `POST /api/v1/auth/resend-verification`. Passwords, OTPs and reset tokens are never placed in frontend environment variables or URLs.
- Password login: `POST /api/v1/auth/login`; server session cookies remain HTTP-only. The local preview may explicitly opt into `LOCAL_PREVIEW_ORIGIN=http://localhost:3000` with a loopback backend; this exception is disabled when `NODE_ENV=production` and rejects arbitrary websites.
- Google: the button checks `GET /api/v1/auth/google/status`, then navigates to the validated canonical HTTPS start URL. Starting OAuth on the callback's own origin is necessary for the browser-bound state cookie. New Google users are job seekers; the employer signup tab retains password registration. Successful callbacks return to the homepage exactly as in the shared backend.
- Recovery: `/forgot-password` calls the backend email flow; `/reset-password` reads a token from the email link fragment and sends it in the request body. Google callback success and error responses remain those of the shared backend.
- Google/SMTP configuration failures remain errors; the frontend never bypasses verification or silently enables demo authentication.

## Validation on 8 September 2026

Backend build, 23 unit tests, isolated MongoDB transaction/API/OTP tests, Google state/account-linking checks and frontend lint/build pass. Existing profile image tests also pass. Live SMTP authentication was verified without sending email. Google configuration and proxied availability endpoint were verified; full live Google consent/callback and actual OTP inbox delivery still require user/provider interaction on the public frontend host. Local preview and the remote tunnel are different browser origins; a remote login does not sign the localhost browser origin in.
