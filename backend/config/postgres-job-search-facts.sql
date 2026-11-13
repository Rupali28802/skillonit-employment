-- Apply after postgres-job-keyword-projection.sql.
BEGIN;
ALTER TABLE job_keyword_projection ADD COLUMN IF NOT EXISTS search_facts jsonb;

CREATE OR REPLACE FUNCTION public_job_search_facts(job jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    || jsonb_build_object(
      'feed', jsonb_build_object(
        'publicListing', job #> '{feed,publicListing}',
        'applicationTarget', job #> '{feed,applicationTarget}'
      ),
      'normalizedFacts', jsonb_build_object(
        'sourceCategory', job #> '{normalizedFacts,sourceCategory}',
        'sourceTags', job #> '{normalizedFacts,sourceTags}',
        'salary', jsonb_build_object('period', job #> '{normalizedFacts,salary,period}')
      )
    )
  FROM jsonb_each(job)
  WHERE key IN (
    'id', 'status', 'sample', 'expiresAt', 'title', 'company', 'description',
    'category', 'state', 'city', 'country', 'eligibleCountries', 'mode',
    'skills', 'type', 'source', 'trust', 'mnc',
    'sourcePostedAt', 'discoveredAt', 'experienceMin', 'experienceMax',
    'experienceDisclosed', 'salaryDisclosed', 'currency', 'salaryMin', 'salaryMax'
  )
$$;

CREATE OR REPLACE FUNCTION sync_job_keyword_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM job_keyword_projection WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO job_keyword_projection(id, search_text, search_facts)
  VALUES (NEW.id, public_job_keyword_text(NEW.data), public_job_search_facts(NEW.data))
  ON CONFLICT (id) DO UPDATE
    SET search_text = EXCLUDED.search_text, search_facts = EXCLUDED.search_facts
    WHERE (job_keyword_projection.search_text, job_keyword_projection.search_facts)
      IS DISTINCT FROM (EXCLUDED.search_text, EXCLUDED.search_facts);
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION backfill_job_search_facts(after_id text, batch_size integer)
RETURNS text LANGUAGE sql AS $$
  WITH batch AS MATERIALIZED (
    SELECT id, data FROM app_documents
    WHERE collection = 'jobs' AND id > after_id
    ORDER BY id LIMIT least(greatest(batch_size, 1), 1000) FOR SHARE
  ), updated AS (
    UPDATE job_keyword_projection AS projection
    SET search_facts = public_job_search_facts(batch.data)
    FROM batch
    WHERE projection.id = batch.id
      AND projection.search_facts IS DISTINCT FROM public_job_search_facts(batch.data)
  ), inserted AS (
    INSERT INTO job_keyword_projection(id, search_text, search_facts)
    SELECT batch.id, public_job_keyword_text(batch.data), public_job_search_facts(batch.data)
    FROM batch
    WHERE NOT EXISTS (
      SELECT 1 FROM job_keyword_projection WHERE id = batch.id OFFSET 0
    )
    ON CONFLICT (id) DO NOTHING
  )
  SELECT max(id) FROM batch
$$;
COMMIT;
