-- Apply after postgres-job-keyword-projection.sql and its backfill.
-- Run outside an explicit transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_keyword_projection_fts_idx
ON job_keyword_projection USING gin (to_tsvector('simple', search_text));
