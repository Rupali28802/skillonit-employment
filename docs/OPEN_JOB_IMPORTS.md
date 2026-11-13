# Open job imports

Install Python 3.11 or newer and PyArrow 26.0.1 in the worker environment, then build the backend. From the repository root, preview the first 1,000 records without a database write:

    node backend/dist/job-engine/bulk-open-jobs.js openjobdata
    node backend/dist/job-engine/bulk-open-jobs.js open-jobs /path/to/extracted/job-parquet-files

The second command accepts one Parquet file per ATS from elliottdehn/open-jobs. The hosted dataset stopped updating on 5 October 2026. The importer accepts only rows seen in the last seven days. To refresh that source, run the upstream crawler separately and supply its newly exported job files. Its archived download cannot supply recurring new jobs.

OpenJobData reads a pinned Hugging Face revision, verifies Parquet checksums, and uses the current snapshot on its first write run. Later runs apply additions, updates, and closures after the saved run cursor. A failed run can be replayed. Both sources reuse the discovery engine's canonical URL job ID, so the same canonical application URL maps to one listing. Different URLs for the same vacancy can still require review.

Set APPLY_OPEN_JOB_IMPORT=true for database writes. The default writes new jobs into review. PUBLISH_OPEN_JOB_IMPORT=true allows eligible new listings to publish. Existing review decisions are preserved. The import uses listing metadata and sends applicants to the employer's original URL.

Run one OpenJobData worker at a time. Example Linux cron entry for a daily run at 03:30 server time, after the initial import has completed:

    30 3 * * * cd /srv/skillonit/backend && APPLY_OPEN_JOB_IMPORT=true OPEN_JOB_IMPORT_PYTHON=/srv/open-jobs-venv/bin/python flock -n /tmp/skillonit-openjobdata.lock node --env-file=.env dist/job-engine/bulk-open-jobs.js openjobdata

Size and benchmark the initial import on a staging database first. The source's active snapshot can contain over a million rows.
