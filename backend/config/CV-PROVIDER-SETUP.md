# Module 2 provider setup

The backend stores private CV binaries in Google Drive and keeps CV metadata, ownership,
processing state, versions and profile confirmation in MongoDB. Scanner and parser adapters
remain trusted HTTPS gateways. No service credentials are supplied by source files.

1. In the existing Google Cloud project, enable **Google Drive API** and create a dedicated
   OAuth 2.0 client for backend CV storage. Grant only
   `https://www.googleapis.com/auth/drive.file` with offline access to
   `skillonitemployment@gmail.com`. Do not use or store the Google account password.
2. Using that OAuth client, create or select one private Drive folder. Do not add `anyone` or
   domain sharing. The adapter verifies the authorized account, folder type, write capability
   and sharing policy before accepting uploads.
3. Store these values only in the deployment secret manager or ignored `backend/.env`:
   `CV_STORAGE_PROVIDER=google-drive`, `CV_GOOGLE_DRIVE_CLIENT_ID`,
   `CV_GOOGLE_DRIVE_CLIENT_SECRET`, `CV_GOOGLE_DRIVE_REFRESH_TOKEN`,
   `CV_GOOGLE_DRIVE_FOLDER_ID`, and
   `CV_GOOGLE_DRIVE_ACCOUNT=skillonitemployment@gmail.com`.
4. Supply the existing trusted HTTPS scanner gateway with `CV_SCANNER_PROVIDER=https`,
   `CV_SCANNER_URL`, and `CV_SCANNER_TOKEN`.
5. Supply the existing trusted HTTPS parser gateway with `CV_PARSER_PROVIDER=https`,
   `CV_PARSER_URL`, `CV_PARSER_TOKEN`, and `CV_PARSER_VERSION`. Extraction may only propose
   source-supported facts; candidate confirmation remains mandatory.
6. Run `npm run cv:check` for configuration syntax validation, then
   `npm run cv:check -- --live` against the intended provider environment. The live probe
   verifies account/folder policy, writes and reads one generated non-personal PDF under a
   unique `cv/validation/` object key, scans and parses it, and permanently deletes it.
   Failed scanning prevents parsing and cleanup is attempted after every write.
7. Validate malware detection with an approved test corpus and factual extraction accuracy
   with reviewed PDF/DOCX samples before release. The generated probe checks connectivity and
   response contracts, not those provider-quality properties.

Module 2 checks: `npm run test:module2` and `npm run test:module2:mongo`. The Mongo suite uses
a disposable local `architecture_test` replica set and never invokes the frontend.

Never paste credentials into source files or reports. Keep `.env` ignored. This setup does not
change `DEMO_MODE`, authentication, Job Matching, the Application Engine, or frontend code.
