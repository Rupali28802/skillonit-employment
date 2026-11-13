-- Run with psql outside an explicit transaction, before enabling
-- ENABLE_POSTGRES_KEYWORD_PREFILTER in the API environment.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public_job_keyword_text(job jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(job->>'title', '') || ' ' ||
         coalesce(job->>'category', '') || ' ' ||
         coalesce(job->>'state', '') || ' ' ||
         coalesce(job->>'city', '') || ' ' ||
         coalesce(job->>'country', '') || ' ' ||
         coalesce(job->>'mode', '') || ' ' ||
         coalesce(job->>'skills', '') || ' ' ||
         coalesce(job->>'type', '') || ' ' ||
         coalesce(job->>'description', '') || ' ' ||
         coalesce(job#>>'{normalizedFacts,sourceCategory}', '') || ' ' ||
         coalesce(job#>>'{normalizedFacts,sourceTags}', '') || ' ' ||
         coalesce(job->>'company', '') || ' ' ||
         coalesce(job->>'eligibleCountries', '')
$$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS app_documents_job_keyword_trgm_idx
  ON app_documents USING gin (public_job_keyword_text(data) gin_trgm_ops)
  WHERE collection = 'jobs';

-- A canceled concurrent build can leave an invalid index behind. Fail this
-- migration so rollout cannot continue until the invalid index is rebuilt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = 'app_documents_job_keyword_trgm_idx'::regclass
      AND indisvalid
  ) THEN
    RAISE EXCEPTION 'Public keyword index is invalid. Drop it concurrently and rerun this migration.';
  END IF;
END
$$;
