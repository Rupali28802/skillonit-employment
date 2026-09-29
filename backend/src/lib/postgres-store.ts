import { Pool, type PoolClient } from 'pg';
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
  if (value && typeof value === 'object') {
    const range = value as Record<string, unknown>;
    const compare = (bound: unknown) => typeof actual === 'number' && typeof bound === 'number' ? actual - bound : String(actual ?? '').localeCompare(String(bound));
    return (!('$gte' in range) || compare(range.$gte) >= 0) && (!('$gt' in range) || compare(range.$gt) > 0) && (!('$lte' in range) || compare(range.$lte) <= 0) && (!('$lt' in range) || compare(range.$lt) < 0) && (!('$ne' in range) || actual !== range.$ne);
  }
  return actual === value;
});
function repository(db: Pool | PoolClient): Repository {
  const rows = async <T>(collection: string) => (await db.query<{ data: T }>('SELECT data FROM app_documents WHERE collection=$1', [collection])).rows.map(row => row.data);
  const put = async (collection: string, value: { id: string }) => db.query('INSERT INTO app_documents(collection,id,data,updated_at) VALUES($1,$2,$3::jsonb,now()) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data,updated_at=now()', [collection, value.id, JSON.stringify(value)]);
  return {
    async putMany(collection, values) { for (const value of values) await put(collection, value); },
    async page<T>(collection: string, query: Query, sort: Record<string, 1 | -1>, skip: number, limit: number) { return (await rows<Row>(collection)).filter(row => matches(row, query)).sort((a,b) => { for (const [key,direction] of Object.entries(sort)) { const av=valueAt(a,key)??'', bv=valueAt(b,key)??''; if(av!==bv) return String(av).localeCompare(String(bv),undefined,{numeric:true})*direction; } return 0; }).slice(skip,skip+limit) as T[]; },
    async count(collection, query={}) { return (await rows<Row>(collection)).filter(row => matches(row,query)).length; },
    async scan<T>(collection:string, query:Query, after='', limit=250) { return (await rows<Row>(collection)).filter(row => row.id>after && matches(row,query)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,Math.min(500,Math.max(1,limit))) as T[]; },
    async find<T>(collection:string, query:Query={}, limit=100) { return (await rows<Row>(collection)).filter(row=>matches(row,query)).slice(0,Math.min(limit,1000)) as T[]; },
    async get<T>(collection:string,id:string) { const result=await db.query<{data:T}>('SELECT data FROM app_documents WHERE collection=$1 AND id=$2',[collection,id]); return result.rows[0]?.data??null; },
    async put(collection,value) { await put(collection,value); },
    async remove(collection,id) { await db.query('DELETE FROM app_documents WHERE collection=$1 AND id=$2',[collection,id]); }
  };
}
export const postgresRead = async <T>(fn:(repo:Repository)=>Promise<T>) => fn(repository(database()));
export async function postgresTransaction<T>(fn:(repo:Repository)=>Promise<T>) { const client=await database().connect(); try { await client.query('BEGIN'); const result=await fn(repository(client)); await client.query('COMMIT'); return result; } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }
export async function bootstrapPostgres() {
  const db=database();
  await db.query(`CREATE TABLE IF NOT EXISTS app_documents (collection text NOT NULL,id text NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(collection,id))`);
  await db.query('CREATE INDEX IF NOT EXISTS app_documents_collection_updated_idx ON app_documents(collection,updated_at DESC)');
  for (const [name,collection,field] of [['users_email','users','email'],['users_google_id','users','googleId'],['employers_owner','employers','ownerId'],['employers_domain','employers','domain'],['student_onboarding_user','studentOnboarding','userId'],['student_preferences_user','studentPreferences','userId'],['automation_preferences_user','automationPreferences','userId'],['student_subscriptions_user','studentSubscriptions','userId'],['mailbox_connections_user','mailboxConnections','userId']]) await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${name}_uq ON app_documents ((data->>'${field}')) WHERE collection='${collection}' AND data ? '${field}'`);
}
export async function closePostgres(){await pool?.end();pool=undefined;}
