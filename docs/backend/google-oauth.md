# Google sign-in setup

Backend routes: GET /api/v1/auth/google and GET /api/v1/auth/google/callback. The frontend uses the existing /api rewrite.

## Google Cloud Console
1. Create/select your project and configure Google Auth Platform Branding, Audience and Data Access. Use External and Testing for development; add your test Google accounts.
2. Create an OAuth client of type Web application.
3. Add this exact authorized redirect URI:

https://pants-skip-events-profession.trycloudflare.com/api/v1/auth/google/callback

4. Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL in backend/.env (never in frontend variables). APP_URL must be the same trusted HTTPS origin. No JavaScript origin is required by this server-side redirect flow. Request only openid, email and profile.
5. Restart the backend; rebuild/restart the frontend for the added button. If a temporary tunnel hostname changes, update both APP_URL and GOOGLE_CALLBACK_URL and the Cloud Console redirect URI.

The secret is never returned to the browser. No Google access/refresh tokens are persisted. Transient oauthStates store a hashed state ID, nonce, PKCE verifier, expiry and optional local-session linking proof; the TTL is ten minutes and callbacks consume state atomically. Exclude callback query strings from proxy/access logs.

Google sign-in is independent of a local password session. After server-side token validation, an existing Google subject authenticates its existing user. A verified Gmail identity or verified Google Workspace identity (signed hd claim) can associate with a matching unlinked email account. Disabled accounts and conflicting Google subjects are rejected. Non-Gmail identities without hd require additional ownership proof for an existing account; email_verified alone is not authoritative for those mailboxes. Existing password, role, profile and associated data are preserved. New Google users have passwordHash=null, authProvider=google, googleId, verified=true and isVerified=true.

Local account-resolution tests are not proof of real Google authentication. Validate real consent, callback, persistence, dashboard refresh and logout followed by Google sign-in before declaring end-to-end completion. Never include provider tokens or cookie values in reports.
