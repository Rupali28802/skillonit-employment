# Module 2 provider setup

The existing backend supports private S3 storage and HTTPS scanner/parser gateways.
Actual bucket, identity and gateway deployments are still required; no service credentials
or deployed infrastructure are supplied by these files.

1. Configure a private, non-versioned bucket with all four Block Public Access flags.
   Use the AWS SDK workload identity/credential chain with narrowly scoped access.
   Set CV_STORAGE_PROVIDER=s3, CV_S3_BUCKET and CV_S3_REGION in your private environment.
2. Supply a trusted HTTPS scanner gateway implementing the contract in
   docs/backend/02-production-hardening.md. Set CV_SCANNER_PROVIDER=https,
   CV_SCANNER_URL and CV_SCANNER_TOKEN privately.
3. Supply a trusted HTTPS parser gateway implementing the same document's contract.
   Set CV_PARSER_PROVIDER=https, CV_PARSER_URL, CV_PARSER_TOKEN and CV_PARSER_VERSION.
   Extraction must only propose source-supported facts; candidate confirmation remains mandatory.
4. Run `npm run cv:check` for configuration syntax validation. This default performs no network requests.
5. Run `npm run cv:check -- --live` only against the intended provider environment.
   It checks bucket policy, writes/reads one generated non-personal PDF under a unique
   `cv/validation/` key, scans it, requests parsing and finally requests deletion.
   Failed scanning prevents parsing. Failed writes still trigger cleanup because a provider
   may have accepted a write before reporting an error. A failed cleanup requires an operator
   to inspect only the validation prefix. A late write after a timeout can require later cleanup.
   Successful delete requests do not independently prove backup deletion or retention compliance.
6. Validate malware detection with an approved test corpus and factual extraction accuracy
   with reviewed PDF/DOCX samples before release. The generated probe checks connectivity and
   response contracts, not those properties. Deploy and validate the existing Redis/CV worker,
   retention policy, managed catalogs and profile-completion configuration as well.

Module 2 checks: `npm run test:module2` and `npm run test:module2:mongo`.
The Mongo suite uses a disposable local architecture_test replica set, never Atlas or .env.
Neither command invokes frontend or future-module test suites.

Never paste credentials into source files or reports. Keep .env ignored. This setup does not
change DEMO_MODE, create a public tunnel, change authentication, or certify production readiness.
