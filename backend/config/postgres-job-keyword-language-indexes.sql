-- Run outside an explicit transaction after the search projection is populated.
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_keyword_projection_cpp_idx
ON job_keyword_projection(id) WHERE search_text ILIKE '%c++%';

CREATE INDEX CONCURRENTLY IF NOT EXISTS job_keyword_projection_csharp_idx
ON job_keyword_projection(id) WHERE search_text ILIKE '%c#%';
