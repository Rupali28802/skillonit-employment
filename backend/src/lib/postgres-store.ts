import { Pool, type PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { postgresUniqueKeys, postgresExpiryCollections } from './postgres-constraints.js';
import { postgresReadFilter } from './postgres-read-filter.js';
import type { Repository, Row } from './store.js';
type Query = Record<string, unknown>;
let pool: Pool | undefined;
export const postgresConfigured = (env = process.env) => Boolean(env.DATABASE_URL?.trim());
function database() {
  if (!process.env.DATABASE_URL) throw new Error('PostgreSQL is not configured.');
  return (pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DATABASE_POOL_SIZE || 20), ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } }));
}
const valueAt = (row: Row, key: string) => key.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, row);
const matches = (row: Row, query: Query): boolean => Object.entries(query).every(([key, value]) => {
  if (key === '$and') return (value as Query[]).every(q => matches(row, q));
  if (key === '$or') return (value as Query[]).some(q => matches(row, q));
  const actual = valueAt(row, key);
  if (value instanceof RegExp) return value.test(Array.isArray(actual) ? actual.join(' ') : String(actual ?? ''));
  if (value && typeof value === 'object' && '$in' in value) return Array.isArray(actual)
    ? actual.some(item => (value.$in as unknown[]).includes(item))
    : (value.$in as unknown[]).includes(actual);
  if (value && typeof value === 'object' && '$nin' in value) return Array.isArray(actual)
    ? actual.every(item => !(value.$nin as unknown[]).includes(item))
    : !(value.$nin as unknown[]).includes(actual);
  if (value && typeof value === 'object') {
    const range = value as Record<string, unknown>;
    const compare = (bound: unknown) => typeof actual === 'number' && typeof bound === 'number' ? actual - bound : String(actual ?? '').localeCompare(String(bound));
    return (!('$gte' in range) || compare(range.$gte) >= 0) && (!('$gt' in range) || compare(range.$gt) > 0) && (!('$lte' in range) || compare(range.$lte) <= 0) && (!('$lt' in range) || compare(range.$lt) < 0) && (!('$ne' in range) || actual !== range.$ne);
  }
  // MongoDB equality against an array means membership. Preserve that behavior
  // while reading the migrated JSON documents from PostgreSQL.
  return Array.isArray(actual) ? actual.includes(value) : actual === value;
});
function repository(db: Pool | PoolClient): Repository {
  const rows = async <T>(collection: string, query: Query) => {
    const filter = postgresReadFilter(query);
    return (await db.query<{ data: T }>('SELECT data FROM app_documents WHERE collection=$1' + filter.sql, [collection, ...filter.values])).rows.map(row => row.data);
  };
  const put = async (collection: string, value: { id: string }) => db.query('INSERT INTO app_documents(collection,id,data,updated_at) VALUES($1,$2,$3::jsonb,now()) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data,updated_at=now()', [collection, value.id, JSON.stringify(value)]);
  return {
    async putMany(collection, values) { for (const value of values) await put(collection, value); },
    async page<T>(collection: string, query: Query, sort: Record<string, 1 | -1>, skip: number, limit: number) {
      const filter = postgresReadFilter(query);
      const lexicalSortFields = new Set(['sourcePostedAt','discoveredAt','updatedAt','createdAt','id']);
      if (filter.complete && Object.keys(sort).every(key => lexicalSortFields.has(key))) {
        const values = [...filter.values];
        const order = Object.entries(sort).map(([key,direction]) => `COALESCE(data #>> ARRAY['${key}'], '') ${direction === -1 ? 'DESC' : 'ASC'}`);
        values.push(Math.max(0,limit),Math.max(0,skip));
        return (await db.query<{data:T}>(`SELECT data FROM app_documents WHERE collection=$1${filter.sql} ORDER BY ${order.join(',')} LIMIT $${values.length} OFFSET $${values.length+1}`,[collection,...values])).rows.map(row=>row.data);
      }
      return (await rows<Row>(collection, query)).filter(row => matches(row, query)).sort((a,b) => { for (const [key,direction] of Object.entries(sort)) { const av=valueAt(a,key)??'', bv=valueAt(b,key)??''; if(av!==bv) return String(av).localeCompare(String(bv),undefined,{numeric:true})*direction; } return 0; }).slice(skip,skip+limit) as T[];
    },
    async count(collection, query={}) {
      const filter = postgresReadFilter(query);
      if (filter.complete) {
        const result = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM app_documents WHERE collection=$1' + filter.sql, [collection, ...filter.values]);
        return Number(result.rows[0]?.count || 0);
      }
      return (await rows<Row>(collection, query)).filter(row => matches(row,query)).length;
    },
    async scan<T>(collection:string, query:Query, after='', limit=250) {
      const filter = postgresReadFilter(query);
      const boundedLimit = Math.min(500, Math.max(1, limit));
      // Keep cursored workers on the database side of the pagination boundary.
      // The former implementation materialized every matching document for each
      // page, which let routine maintenance starve short-interval discovery.
      if (filter.complete) {
        const values = [...filter.values, after, boundedLimit];
        return (await db.query<{data:T}>(
          `SELECT data FROM app_documents WHERE collection=$1${filter.sql} AND id > $${values.length} ORDER BY id ASC LIMIT $${values.length + 1}`,
          [collection, ...values],
        )).rows.map(row => row.data);
      }
      return (await rows<Row>(collection, query)).filter(row => row.id>after && matches(row,query)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,boundedLimit) as T[];
    },
    async find<T>(collection:string, query:Query={}, limit=100) { return (await rows<Row>(collection, query)).filter(row=>matches(row,query)).slice(0,Math.min(limit,1000)) as T[]; },
    async get<T>(collection:string,id:string) { const result=await db.query<{data:T}>('SELECT data FROM app_documents WHERE collection=$1 AND id=$2',[collection,id]); return result.rows[0]?.data??null; },
    async put(collection,value) { await put(collection,value); },
    async remove(collection,id) { await db.query('DELETE FROM app_documents WHERE collection=$1 AND id=$2',[collection,id]); }
  };
}
export const postgresRead = async <T>(fn:(repo:Repository)=>Promise<T>) => fn(repository(database()));
// Public search must never leave an unbounded read running after a browser,
// proxy, or client disconnects. Keep the limit scoped to this explicit helper;
// discovery and transactional writes retain their own execution budgets.
export async function postgresReadWithTimeout<T>(timeoutMs: number, fn: (repo: Repository) => Promise<T>): Promise<T> {
  const bounded = Math.max(1000, Math.min(30000, Math.floor(timeoutMs)));
  const client = await database().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${bounded}`);
    const result = await fn(repository(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Public keyword search is deliberately kept in PostgreSQL instead of reading
 * every job document into a Node worker and applying regular expressions there.
 * That former fallback could hold an API connection open long enough to affect
 * the discovery worker.  This narrow helper only serves the uncomplicated
 * public text-search case; faceted queries keep their existing matcher so their
 * semantics do not silently change.
 */
export async function postgresPublicKeywordSearch<T>(words: string[], sort: 'posted' | 'discovered', skip: number, limit: number) {
  if (!words.length) return { jobs: [] as T[], total: 0 };
  const boundedSkip = Math.max(0, Math.floor(skip));
  const boundedLimit = Math.max(1, Math.min(25, Math.floor(limit)));
  const client = await database().connect();
  try {
    await client.query('BEGIN READ ONLY');
    // This path avoids Node-side materialization of the full job collection.
    // It still has a bounded database budget because the broad JSON projection
    // is intentionally an interim solution until a maintenance-window search
    // projection/index is installed.
    await client.query('SET LOCAL statement_timeout = 12000');
    const predicates = words.map((_, index) => `data::text ILIKE $${index + 1}`).join(' AND ');
    const order = sort === 'discovered'
      ? `COALESCE(data #>> ARRAY['discoveredAt'], '') DESC, id ASC`
      : `COALESCE(data #>> ARRAY['sourcePostedAt'], '') DESC, COALESCE(data #>> ARRAY['discoveredAt'], '') DESC, id ASC`;
    const result = await client.query<{ data: T; total: string }>(`
      WITH matched AS MATERIALIZED (
        SELECT id, data FROM app_documents
        WHERE collection='jobs'
          -- Match the JSONB expressions used by the public partial indexes.
          -- Text extraction is equivalent for this field, but prevents the
          -- planner from proving the index predicate.
          AND data #> ARRAY['status']='"published"'::jsonb
          AND data #>> ARRAY['expiresAt'] > now()::text
          AND (data #> ARRAY['sample'] IS NULL OR data #> ARRAY['sample'] <> 'true'::jsonb)
          AND ${predicates}
      )
      SELECT count(*) OVER()::text AS total, data
      FROM matched
      ORDER BY ${order}
      LIMIT $${words.length + 1} OFFSET $${words.length + 2}`,
      [...words.map(word => `%${word.replace(/[\\%_]/g, '\\$&')}%`), boundedLimit, boundedSkip],
    );
    await client.query('COMMIT');
    return { jobs: result.rows.map(row => row.data), total: Number(result.rows[0]?.total || 0) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Fast path for the location selector, preserving MongoDB array-membership
 * semantics for a job's explicitly eligible countries. */
export async function postgresPublicCountrySearch<T>(country: string, sort: 'posted' | 'discovered', skip: number, limit: number) {
  const normalized = country.trim();
  if (!normalized) return { jobs: [] as T[], total: 0 };
  const boundedSkip = Math.max(0, Math.floor(skip));
  const boundedLimit = Math.max(1, Math.min(25, Math.floor(limit)));
  const client = await database().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL statement_timeout = 12000');
    const order = sort === 'discovered'
      ? `COALESCE(data #>> ARRAY['discoveredAt'], '') DESC, id ASC`
      : `COALESCE(data #>> ARRAY['sourcePostedAt'], '') DESC, COALESCE(data #>> ARRAY['discoveredAt'], '') DESC, id ASC`;
    const result = await client.query<{ data: T; total: string }>(`
      WITH matched AS MATERIALIZED (
        SELECT id, data FROM app_documents
        WHERE collection='jobs'
          AND data #> ARRAY['status']='"published"'::jsonb
          AND data #>> ARRAY['expiresAt'] > now()::text
          AND (data #> ARRAY['sample'] IS NULL OR data #> ARRAY['sample'] <> 'true'::jsonb)
          AND (data #>> ARRAY['country']=$1 OR data #> ARRAY['eligibleCountries'] @> $2::jsonb)
      )
      SELECT count(*) OVER()::text AS total, data
      FROM matched
      ORDER BY ${order}
      LIMIT $3 OFFSET $4`,
      [normalized, JSON.stringify([normalized]), boundedLimit, boundedSkip],
    );
    await client.query('COMMIT');
    return { jobs: result.rows.map(row => row.data), total: Number(result.rows[0]?.total || 0) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fast path for the exact category and work-mode selectors. Both fields have
 * ordered partial indexes, so keep these simple public requests in PostgreSQL
 * instead of materializing the full jobs collection in the API process.
 */
export async function postgresPublicFacetSearch<T>(field: 'category' | 'mode', value: string, sort: 'posted' | 'discovered', skip: number, limit: number) {
  const normalized = value.trim();
  if (!normalized) return { jobs: [] as T[], total: 0 };
  const boundedSkip = Math.max(0, Math.floor(skip));
  const boundedLimit = Math.max(1, Math.min(25, Math.floor(limit)));
  // Keep this SQL fragment closed over a fixed selector. Request values always
  // remain parameters and can never become part of the query text.
  const fieldExpression = field === 'category'
    ? "data #> ARRAY['category']"
    : "data #> ARRAY['mode']";
  const client = await database().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL statement_timeout = 12000');
    const order = sort === 'discovered'
      ? `COALESCE(data #>> ARRAY['discoveredAt'], '') DESC, id ASC`
      : `COALESCE(data #>> ARRAY['sourcePostedAt'], '') DESC, COALESCE(data #>> ARRAY['discoveredAt'], '') DESC, id ASC`;
    const result = await client.query<{ data: T; total: string }>(`
      WITH matched AS MATERIALIZED (
        SELECT id, data FROM app_documents
        WHERE collection='jobs'
          AND data #> ARRAY['status']='"published"'::jsonb
          AND data #>> ARRAY['expiresAt'] > now()::text
          AND (data #> ARRAY['sample'] IS NULL OR data #> ARRAY['sample'] <> 'true'::jsonb)
          AND ${fieldExpression} = to_jsonb($1::text)
      )
      SELECT count(*) OVER()::text AS total, data
      FROM matched
      ORDER BY ${order}
      LIMIT $2 OFFSET $3`,
      [normalized, boundedLimit, boundedSkip],
    );
    await client.query('COMMIT');
    return { jobs: result.rows.map(row => row.data), total: Number(result.rows[0]?.total || 0) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Fast path for the fixed employment-type selector values. */
export async function postgresPublicTypeSearch<T>(normalizedType: string, sort: 'posted' | 'discovered', skip: number, limit: number) {
  const boundedSkip = Math.max(0, Math.floor(skip));
  const boundedLimit = Math.max(1, Math.min(25, Math.floor(limit)));
  const client = await database().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL statement_timeout = 12000');
    const order = sort === 'discovered'
      ? `COALESCE(data #>> ARRAY['discoveredAt'], '') DESC, id ASC`
      : `COALESCE(data #>> ARRAY['sourcePostedAt'], '') DESC, COALESCE(data #>> ARRAY['discoveredAt'], '') DESC, id ASC`;
    const result = await client.query<{ data: T; total: string }>(`
      WITH matched AS MATERIALIZED (
        SELECT id, data FROM app_documents
        WHERE collection='jobs'
          AND data #> ARRAY['status']='"published"'::jsonb
          AND data #>> ARRAY['expiresAt'] > now()::text
          AND (data #> ARRAY['sample'] IS NULL OR data #> ARRAY['sample'] <> 'true'::jsonb)
          -- Keep combined employment types (for example, "Full-time,
          -- Permanent") visible for the same selector value as before.
          AND regexp_replace(lower(COALESCE(data #>> ARRAY['type'], '')), '[ _-]+', '', 'g') LIKE '%' || $1 || '%'
      )
      SELECT count(*) OVER()::text AS total, data
      FROM matched
      ORDER BY ${order}
      LIMIT $2 OFFSET $3`,
      [normalizedType, boundedLimit, boundedSkip],
    );
    await client.query('COMMIT');
    return { jobs: result.rows.map(row => row.data), total: Number(result.rows[0]?.total || 0) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
// Like MongoDB withTransaction, the callback can be replayed. Keep external
// side effects outside it; only a committed attempt may publish its result.
export async function postgresTransaction<T>(fn: (repo: Repository) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await database().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await fn(repository(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      const code = (error as { code?: string }).code;
      if (!['40001', '40P01'].includes(code || '') || attempt >= 7) throw error;
    } finally { client.release(); }
    await delay(Math.min(200, 5 * 2 ** attempt) + Math.floor(Math.random() * 10));
  }
}

const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
const jsonField = (field: string) => `data #> ARRAY[${field.split('.').map(sqlLiteral).join(',')}]`;
export function postgresUniqueDefinitions() {
  return postgresUniqueKeys.map(key => ({
    collection: key.collection,
    name: 'app_uq_v2_' + createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 20),
    expressions: key.fields.map(field => `COALESCE(${jsonField(field)}, 'null'::jsonb)`),
    predicate: [`collection = ${sqlLiteral(key.collection)}`, ...(key.stringFields || []).map(field => `jsonb_typeof(${jsonField(field)}) = 'string'`)].join(' AND '),
  }));
}

export async function postgresUniqueConflicts(db: Pool | PoolClient = database()) {
  const conflicts: { collection: string; index: string; groups: number }[] = [];
  for (const key of postgresUniqueDefinitions()) {
    const result = await db.query<{ groups: number }>(`SELECT count(*)::int AS groups FROM (SELECT 1 FROM app_documents WHERE ${key.predicate} GROUP BY ${key.expressions.join(',')} HAVING count(*) > 1) duplicates`);
    if (result.rows[0].groups) conflicts.push({ collection: key.collection, index: key.name, groups: result.rows[0].groups });
  }
  return conflicts;
}

async function ensurePostgresIndex(db: Pool | PoolClient, name: string, statement: string) {
  // `CREATE INDEX IF NOT EXISTS` still takes a DDL lock while checking the
  // catalog. Workers call bootstrap on every start, so avoid that lock for an
  // index that is already present. A new deployment can still create it.
  const existing = await db.query<{ valid: boolean }>(
    `SELECT COALESCE(bool_or(indexes.indisvalid), false) AS valid
       FROM pg_class classes
       JOIN pg_index indexes ON indexes.indexrelid = classes.oid
      WHERE classes.relkind = 'i' AND classes.relname = $1`,
    [name],
  );
  if (!existing.rows[0]?.valid) await db.query(statement);
}

export async function bootstrapPostgres() {
  const db = await database().connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout = '10s'");
    await db.query(`CREATE TABLE IF NOT EXISTS app_documents (collection text NOT NULL,id text NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(collection,id))`);
    // Startup runs in every worker process. Do not take a table-wide exclusive
    // lock here: the existing unique indexes remain the database authority and
    // a busy production table must not prevent a discovery worker from starting.
    // The database unique indexes below remain the authority for duplicate
    // prevention. Do not scan every collection during ordinary worker startup;
    // such a diagnostic pass can delay discovery for minutes on a live system.
    await ensurePostgresIndex(db, 'app_documents_collection_updated_idx', 'CREATE INDEX app_documents_collection_updated_idx ON app_documents(collection,updated_at DESC)');
    // Operations dashboards frequently filter by lifecycle status.  Without this
    // expression index, PostgreSQL must scan the full jobs collection for every
    // pending-review count and can exceed the reverse-proxy timeout.
    await ensurePostgresIndex(db, 'app_documents_collection_status_idx', `CREATE INDEX app_documents_collection_status_idx ON app_documents(collection, (data #> ARRAY['status']))`);
    // A feed refresh closes only variants for the current source.  This index
    // keeps that reconciliation bounded instead of scanning every historical
    // feed variant on each short-interval discovery run.
    await ensurePostgresIndex(db, 'app_documents_feed_variants_active_idx', `CREATE INDEX app_documents_feed_variants_active_idx ON app_documents ((data #> ARRAY['sourceId']), (data #> ARRAY['active']), id) WHERE collection='jobFeedVariants'`);
    await ensurePostgresIndex(db, 'app_documents_jobs_public_filter_idx', `CREATE INDEX app_documents_jobs_public_filter_idx ON app_documents ((data #> ARRAY['expiresAt']), (data #> ARRAY['discoveredAt'])) WHERE collection='jobs' AND (data #> ARRAY['status'])='"published"'::jsonb AND ((data #> ARRAY['sample']) IS NULL OR (data #> ARRAY['sample']) <> 'true'::jsonb)`);
    await ensurePostgresIndex(db, 'app_documents_jobs_public_order_idx', `CREATE INDEX app_documents_jobs_public_order_idx ON app_documents ((COALESCE(data #>> ARRAY['sourcePostedAt'],'')) DESC, (COALESCE(data #>> ARRAY['discoveredAt'],'')) DESC, id) WHERE collection='jobs' AND (data #> ARRAY['status'])='"published"'::jsonb AND ((data #> ARRAY['sample']) IS NULL OR (data #> ARRAY['sample']) <> 'true'::jsonb)`);
    // Keep common public category filtering on a narrow, ordered partial index.
    // The live index is installed concurrently as a maintenance operation; this
    // definition preserves it for clean database/bootstrap environments.
    await ensurePostgresIndex(db, 'app_documents_jobs_public_category_v1_idx', `CREATE INDEX app_documents_jobs_public_category_v1_idx ON app_documents ((data #> ARRAY['category']), (COALESCE(data #>> ARRAY['sourcePostedAt'],'')) DESC, (COALESCE(data #>> ARRAY['discoveredAt'],'')) DESC, id) WHERE collection='jobs' AND (data #> ARRAY['status'])='"published"'::jsonb AND ((data #> ARRAY['sample']) IS NULL OR (data #> ARRAY['sample']) <> 'true'::jsonb)`);
    await ensurePostgresIndex(db, 'app_documents_jobs_public_country_v1_idx', `CREATE INDEX app_documents_jobs_public_country_v1_idx ON app_documents ((data #>> ARRAY['country']), (COALESCE(data #>> ARRAY['sourcePostedAt'],'')) DESC, (COALESCE(data #>> ARRAY['discoveredAt'],'')) DESC, id) WHERE collection='jobs' AND (data #> ARRAY['status'])='"published"'::jsonb AND ((data #> ARRAY['sample']) IS NULL OR (data #> ARRAY['sample']) <> 'true'::jsonb)`);
    await ensurePostgresIndex(db, 'app_documents_jobs_public_eligible_countries_v1_idx', `CREATE INDEX app_documents_jobs_public_eligible_countries_v1_idx ON app_documents USING GIN ((data #> ARRAY['eligibleCountries']) jsonb_path_ops) WHERE collection='jobs' AND (data #> ARRAY['status'])='"published"'::jsonb AND ((data #> ARRAY['sample']) IS NULL OR (data #> ARRAY['sample']) <> 'true'::jsonb)`);
    await ensurePostgresIndex(db, 'app_documents_jobs_public_mode_v1_idx', `CREATE INDEX app_documents_jobs_public_mode_v1_idx ON app_documents ((data #> ARRAY['mode']), (COALESCE(data #>> ARRAY['sourcePostedAt'],'')) DESC, (COALESCE(data #>> ARRAY['discoveredAt'],'')) DESC, id) WHERE collection='jobs' AND (data #> ARRAY['status'])='"published"'::jsonb AND ((data #> ARRAY['sample']) IS NULL OR (data #> ARRAY['sample']) <> 'true'::jsonb)`);
    await ensurePostgresIndex(db, 'app_documents_jobs_public_type_v1_idx', `CREATE INDEX app_documents_jobs_public_type_v1_idx ON app_documents ((regexp_replace(lower(COALESCE(data #>> ARRAY['type'],'')), '[ _-]+','','g')), (COALESCE(data #>> ARRAY['sourcePostedAt'],'')) DESC, (COALESCE(data #>> ARRAY['discoveredAt'],'')) DESC, id) WHERE collection='jobs' AND (data #> ARRAY['status'])='"published"'::jsonb AND ((data #> ARRAY['sample']) IS NULL OR (data #> ARRAY['sample']) <> 'true'::jsonb)`);
    // The landing page defaults to discovered-date order (without sourcePostedAt),
    // so it needs its own matching partial index rather than scanning/sorting all
    // published job documents on every request.
    // v2 can exist from an interrupted historical build and be marked invalid
    // by PostgreSQL. Keep it for later maintenance; v3 is an independent valid
    // replacement that can be built online before this code is deployed.
    await ensurePostgresIndex(db, 'app_documents_jobs_public_discovered_v3_idx', `CREATE INDEX app_documents_jobs_public_discovered_v3_idx ON app_documents ((COALESCE(data #>> ARRAY['discoveredAt'],'')) DESC, id) WHERE collection='jobs' AND (data #> ARRAY['status'])='"published"'::jsonb AND ((data #> ARRAY['sample']) IS NULL OR (data #> ARRAY['sample']) <> 'true'::jsonb)`);
    for (const key of postgresUniqueDefinitions()) await ensurePostgresIndex(db, key.name, `CREATE UNIQUE INDEX ${key.name} ON app_documents (${key.expressions.map(expression => `(${expression})`).join(',')}) WHERE ${key.predicate}`);
    // Legacy-index cleanup is an explicit maintenance operation, never a
    // worker-startup action. Dropping an index takes locks that can make a
    // healthy background worker fail to start under normal application load.
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

// PostgreSQL has no MongoDB TTL monitor. The existing retention scheduler calls
// this bounded maintenance operation; malformed/missing dates are retained.
export async function prunePostgresExpiredDocuments(now = new Date(), limit = 250) {
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('INVALID_EXPIRY_BATCH');
  const result = await database().query<{ collection: string }>(`
    WITH expired AS (
      SELECT collection, id FROM app_documents
      WHERE collection = ANY($1::text[]) AND
        CASE WHEN jsonb_typeof(data->'expiresAtDate') = 'string'
          AND data->>'expiresAtDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          AND pg_input_is_valid(data->>'expiresAtDate', 'timestamp with time zone')
        THEN (data->>'expiresAtDate')::timestamptz <= $2::timestamptz ELSE false END
      ORDER BY collection, id LIMIT $3 FOR UPDATE SKIP LOCKED
    ) DELETE FROM app_documents a USING expired e
      WHERE a.collection=e.collection AND a.id=e.id RETURNING a.collection`,
    [postgresExpiryCollections, now.toISOString(), limit]);
  return result.rows.reduce<Record<string, number>>((counts, row) => { counts[row.collection] = (counts[row.collection] || 0) + 1; return counts; }, {});
}
export async function closePostgres(){await pool?.end();pool=undefined;}
