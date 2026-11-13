-- Apply after the keyword projection migration. Adding a nullable column
-- avoids rewriting the live projection while holding an exclusive lock.
BEGIN;
ALTER TABLE job_keyword_projection ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION sync_job_keyword_vector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', NEW.search_text);
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER job_keyword_projection_vector
BEFORE INSERT OR UPDATE OF search_text ON job_keyword_projection
FOR EACH ROW EXECUTE FUNCTION sync_job_keyword_vector();
COMMIT;

-- Run each call in its own transaction, starting with an empty cursor.
-- Pass the returned cursor to the next call and stop at NULL.
CREATE OR REPLACE FUNCTION backfill_job_keyword_vector(after_id text, batch_size integer)
RETURNS text LANGUAGE sql AS $$
  WITH batch AS MATERIALIZED (
    SELECT id FROM job_keyword_projection
    WHERE id > after_id AND search_vector IS NULL
    ORDER BY id LIMIT least(greatest(batch_size, 1), 2000)
    FOR UPDATE
  ), written AS (
    UPDATE job_keyword_projection AS projection
    SET search_vector = to_tsvector('simple', projection.search_text)
    FROM batch WHERE projection.id = batch.id
  )
  SELECT max(id) FROM batch
$$;

-- Run after backfill, outside an explicit transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_keyword_projection_stored_vector_idx
ON job_keyword_projection USING gin (search_vector);
