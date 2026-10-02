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
  if (value && typeof value === 'object' && '$in' in value) return (value.$in as unknown[]).includes(actual);
  if (value && typeof value === 'object' && '$nin' in value) return !(value.$nin as unknown[]).includes(actual);
  if (value && typeof value === 'object') {
    const range = value as Record<string, unknown>;
    const compare = (bound: unknown) => typeof actual === 'number' && typeof bound === 'number' ? actual - bound : String(actual ?? '').localeCompare(String(bound));
    return (!('$gte' in range) || compare(range.$gte) >= 0) && (!('$gt' in range) || compare(range.$gt) > 0) && (!('$lte' in range) || compare(range.$lte) <= 0) && (!('$lt' in range) || compare(range.$lt) < 0) && (!('$ne' in range) || actual !== range.$ne);
  }
  return actual === value;
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
    async scan<T>(collection:string, query:Query, after='', limit=250) { return (await rows<Row>(collection, query)).filter(row => row.id>after && matches(row,query)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,Math.min(500,Math.max(1,limit))) as T[]; },
    async find<T>(collection:string, query:Query={}, limit=100) { return (await rows<Row>(collection, query)).filter(row=>matches(row,query)).slice(0,Math.min(limit,1000)) as T[]; },
    async get<T>(collection:string,id:string) { const result=await db.query<{data:T}>('SELECT data FROM app_documents WHERE collection=$1 AND id=$2',[collection,id]); return result.rows[0]?.data??null; },
    async put(collection,value) { await put(collection,value); },
    async remove(collection,id) { await db.query('DELETE FROM app_documents WHERE collection=$1 AND id=$2',[collection,id]); }
  };
}
export const postgresRead = async <T>(fn:(repo:Repository)=>Promise<T>) => fn(repository(database()));
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

export async function bootstrapPostgres() {
  const db = await database().connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout = '10s'");
    await db.query(`CREATE TABLE IF NOT EXISTS app_documents (collection text NOT NULL,id text NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(collection,id))`);
    // Hold writers while checking/installing constraints, so a concurrent insert
    // cannot invalidate the preflight. Existing rows are never repaired/deleted.
    await db.query('LOCK TABLE app_documents IN SHARE ROW EXCLUSIVE MODE');
    const conflicts = await postgresUniqueConflicts(db);
    if (conflicts.length) throw new Error('POSTGRES_UNIQUE_CONFLICTS: ' + JSON.stringify(conflicts));
    await db.query('CREATE INDEX IF NOT EXISTS app_documents_collection_updated_idx ON app_documents(collection,updated_at DESC)');
    await db.query(`CREATE INDEX IF NOT EXISTS app_documents_jobs_public_filter_idx ON app_documents ((data #> ARRAY['expiresAt']), (data #> ARRAY['discoveredAt'])) WHERE collection='jobs' AND (data #> ARRAY['status'])='"published"'::jsonb AND ((data #> ARRAY['sample']) IS NULL OR (data #> ARRAY['sample']) <> 'true'::jsonb)`);
    await db.query(`CREATE INDEX IF NOT EXISTS app_documents_jobs_public_order_idx ON app_documents ((COALESCE(data #>> ARRAY['sourcePostedAt'],'')) DESC, (COALESCE(data #>> ARRAY['discoveredAt'],'')) DESC, id) WHERE collection='jobs' AND (data #> ARRAY['status'])='"published"'::jsonb AND ((data #> ARRAY['sample']) IS NULL OR (data #> ARRAY['sample']) <> 'true'::jsonb)`);
    for (const key of postgresUniqueDefinitions()) await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${key.name} ON app_documents (${key.expressions.map(expression => `(${expression})`).join(',')}) WHERE ${key.predicate}`);
    // Replace weaker legacy definitions only after all replacements succeed.
    for (const name of ['users_email','users_google_id','employers_owner','employers_domain','student_onboarding_user','student_preferences_user','automation_preferences_user','student_subscriptions_user','mailbox_connections_user']) await db.query(`DROP INDEX IF EXISTS ${name}_uq`);
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
