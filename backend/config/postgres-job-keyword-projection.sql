-- Apply after postgres-public-keyword-search.sql. The trigger must be active
-- before backfill so concurrent job updates also update the projection.
CREATE TABLE IF NOT EXISTS job_keyword_projection (
  id text PRIMARY KEY,
  search_text text NOT NULL
);

CREATE OR REPLACE FUNCTION sync_job_keyword_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM job_keyword_projection WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO job_keyword_projection(id, search_text)
  VALUES (NEW.id, public_job_keyword_text(NEW.data))
  ON CONFLICT (id) DO UPDATE SET search_text = EXCLUDED.search_text
    WHERE job_keyword_projection.search_text IS DISTINCT FROM EXCLUDED.search_text;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER job_keyword_projection_upsert
AFTER INSERT OR UPDATE OF data ON app_documents
FOR EACH ROW WHEN (NEW.collection = 'jobs')
EXECUTE FUNCTION sync_job_keyword_projection();

CREATE OR REPLACE TRIGGER job_keyword_projection_delete
AFTER DELETE ON app_documents
FOR EACH ROW WHEN (OLD.collection = 'jobs')
EXECUTE FUNCTION sync_job_keyword_projection();

-- Backfill in bounded transactions using the ordered document primary key.
-- Lock source rows before copying so a concurrent delete cannot leave a
-- projection row behind and a concurrent update cannot be overwritten.
-- Call SELECT backfill_job_keyword_projection('', 500), then pass the returned
-- cursor to the next call. Commit each call and stop at NULL.
CREATE OR REPLACE FUNCTION backfill_job_keyword_projection(after_id text, batch_size integer)
RETURNS text LANGUAGE sql AS $$
  WITH batch AS MATERIALIZED (
    SELECT id, data FROM app_documents
    WHERE collection = 'jobs' AND id > after_id
    ORDER BY id LIMIT least(greatest(batch_size, 1), 2000) FOR SHARE
  ), written AS (
    INSERT INTO job_keyword_projection(id, search_text)
    SELECT id, public_job_keyword_text(data) FROM batch
    ON CONFLICT (id) DO NOTHING
  )
  SELECT max(id) FROM batch
$$;

-- Run outside an explicit transaction. Keep the API feature disabled until
-- the backfill has reached the end and the index is valid.
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_keyword_projection_trgm_idx
ON job_keyword_projection USING gin (search_text gin_trgm_ops);
