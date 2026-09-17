import {
  MongoClient,
  type ClientSession,
  type Filter,
  type Document,
} from 'mongodb';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { sampleJobs } from './fixtures.js';
import { plans } from './domain.js';
import { demoEnabled } from './runtime-config.js';
export type Row = { id: string; [key: string]: unknown };
export const demoMode = () => demoEnabled();
type Query = Record<string, unknown>;
export interface Repository {
  putMany<T extends { id: string }>(collection: string, rows: T[]): Promise<void>;
  page<T>(collection: string, query: Query, sort: Record<string, 1 | -1>, skip: number, limit: number): Promise<T[]>;
  count(collection: string, query?: Query): Promise<number>;
  scan<T>(
    collection: string,
    query: Query,
    after?: string,
    limit?: number,
  ): Promise<T[]>;
  find<T>(collection: string, query?: Query, limit?: number): Promise<T[]>;
  get<T>(collection: string, id: string): Promise<T | null>;
  put<T extends { id: string }>(collection: string, row: T): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
}
type LocalData = Record<string, Record<string, Row>>;
let client: MongoClient | undefined;
let lock: Promise<unknown> = Promise.resolve();
export async function closeStore() {
  await client?.close();
  client = undefined;
}
function mongo() {
  if (!process.env.MONGODB_URI) throw Error('MongoDB is not configured.');
  return (client ??= new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 30,
    serverSelectionTimeoutMS: 5000,
  }));
}
function mongoRepo(session?: ClientSession): Repository {
  const db = mongo().db(process.env.MONGODB_DATABASE || 'skillonit');
  return {
    async putMany(c, rows) {
      if (rows.length) await db.collection(c).bulkWrite(rows.map(row => ({ replaceOne: { filter: { id: row.id }, replacement: row, upsert: true } })), { session });
    },
    async page<T>(c: string, q: Query, sort: Record<string, 1 | -1>, skip: number, limit: number) {
      return (await db.collection(c).find(q as Filter<Document>, { session, projection: { _id: 0 } })
        .sort(sort).skip(skip).limit(limit).toArray()) as T[];
    },
    async count(c, q = {}) {
      return db
        .collection(c)
        .countDocuments(q as Filter<Document>, { session });
    },
    async scan<T>(c: string, q: Query, after = '', limit = 250) {
      return (await db
        .collection(c)
        .find(
          {
            ...q,
            ...(after ? { id: { $gt: after } } : {}),
          } as Filter<Document>,
          {
            session,
            projection: { _id: 0 },
          },
        )
        .sort({ id: 1 })
        .limit(Math.min(500, Math.max(1, limit)))
        .toArray()) as T[];
    },
    async find<T>(c: string, q: Query = {}, limit = 100) {
      return (await db
        .collection(c)
        .find(q as Filter<Document>, { session, projection: { _id: 0 } })
        .limit(Math.min(limit, 1000))
        .toArray()) as T[];
    },
    async get<T>(c: string, id: string) {
      return (await db
        .collection(c)
        .findOne({ id }, { session, projection: { _id: 0 } })) as T | null;
    },
    async put(c, row) {
      await db
        .collection(c)
        .replaceOne({ id: row.id }, row, { upsert: true, session });
    },
    async remove(c, id) {
      await db.collection(c).deleteOne({ id }, { session });
    },
  };
}
function localRepo(data: LocalData): Repository {
  const matches = (row: Row, query: Query): boolean =>
    Object.entries(query).every(([key, value]) => {
      if (key === '$and') return (value as Query[]).every(q => matches(row, q));
      if (key === '$or') return (value as Query[]).some(q => matches(row, q));
      if (value instanceof RegExp) return value.test(Array.isArray(row[key]) ? (row[key] as unknown[]).join(' ') : String(row[key] ?? ''));
      if (value && typeof value === 'object' && '$in' in value) return (value.$in as unknown[]).includes(row[key]);
      if (value && typeof value === 'object') {
        const range = value as Record<string, unknown>;
        const actual = row[key];
        const compare = (bound: unknown) => typeof actual === 'number' && typeof bound === 'number'
          ? actual - bound : String(actual ?? '').localeCompare(String(bound));
        return (
          (!('$gte' in range) || compare(range.$gte) >= 0) &&
          (!('$gt' in range) || compare(range.$gt) > 0) &&
          (!('$lte' in range) || compare(range.$lte) <= 0) &&
          (!('$ne' in range) || row[key] !== range.$ne) &&
          (!('$lt' in range) || compare(range.$lt) < 0)
        );
      }
      return row[key] === value;
    });
  return {
    async putMany(c, rows) {
      data[c] ??= {};
      for (const row of rows) data[c][row.id] = row as Row;
    },
    async page<T>(c: string, q: Query, sort: Record<string, 1 | -1>, skip: number, limit: number) {
      return Object.values(data[c] || {}).filter(row => matches(row, q)).sort((a, b) => {
        for (const [key, direction] of Object.entries(sort)) {
          const av = a[key] ?? '', bv = b[key] ?? '';
          if (av !== bv) return (av < bv ? -1 : 1) * direction;
        }
        return 0;
      }).slice(skip, skip + limit) as T[];
    },
    async count(c, q = {}) {
      return Object.values(data[c] || {}).filter((row) => matches(row, q))
        .length;
    },
    async scan<T>(c: string, q: Query, after = '', limit = 250) {
      return Object.values(data[c] || {})
        .filter((row) => matches(row, q) && row.id > after)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, Math.min(500, Math.max(1, limit))) as T[];
    },
    async find<T>(c: string, q: Query = {}, limit = 100) {
      return Object.values(data[c] || {})
        .filter((r) => matches(r, q))
        .slice(0, limit) as T[];
    },
    async get<T>(c: string, id: string) {
      return (data[c]?.[id] || null) as T | null;
    },
    async put(c, row) {
      data[c] ??= {};
      data[c][row.id] = row as Row;
    },
    async remove(c, id) {
      delete data[c]?.[id];
    },
  };
}
const directory = () => path.join(process.cwd(), '.data');
async function loadLocal() {
  try {
    return JSON.parse(
      await readFile(path.join(directory(), 'store.json'), 'utf8'),
    ) as LocalData;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return {
      jobs: Object.fromEntries(sampleJobs().map((j) => [j.id, j])),
    } as unknown as LocalData;
  }
}
export async function transaction<T>(
  fn: (r: Repository) => Promise<T>,
): Promise<T> {
  if (process.env.MONGODB_URI) {
    const session = mongo().startSession();
    try {
      return await session.withTransaction(() => fn(mongoRepo(session)));
    } finally {
      await session.endSession();
    }
  }
  if (!demoMode()) throw Error('Production persistence is not configured.');
  const task = lock.then(async () => {
    const data = await loadLocal();
    const result = await fn(localRepo(data));
    await mkdir(directory(), { recursive: true });
    const temp = path.join(directory(), 'store.tmp');
    await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
    await rename(temp, path.join(directory(), 'store.json'));
    return result;
  });
  lock = task.catch(() => {});
  return task;
}
export async function read<T>(fn: (r: Repository) => Promise<T>): Promise<T> {
  if (process.env.MONGODB_URI) return fn(mongoRepo());
  if (!demoMode()) throw Error('Production persistence is not configured.');
  await lock;
  return fn(localRepo(await loadLocal()));
}
export async function configuredPlans() {
  return read(async (r) => {
    const p = await r.get<{ id: string; value: typeof plans }>(
      'systemConfig',
      'plans',
    );
    return p?.value || plans;
  });
}
export async function bootstrapIndexes() {
  // Reject standalone deployments before any index writes. No demo fallback.
  const hello = await mongo().db('admin').command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid')
    throw new Error('MongoDB transaction-capable topology required.');
  const db = mongo().db(process.env.MONGODB_DATABASE || 'skillonit');
  await db.collection('matchingIndexState').createIndex({ id: 1 }, { unique: true });
  await db.collection('jobs').createIndex({ status: 1, trust: 1, id: 1 });
  for (const c of [
    'users',
    'sessions',
    'jobs',
    'applications',
    'savedJobs',
    'profiles',
    'profileMedia',
    'employers',
    'leads',
    'auditLogs',
    'systemConfig',
    'rateLimits',
    'verifications',
    'passwordResets',
    'applicationTemplates',
    'notifications',
    'fraudReports',
    'jobSources',
    'jobFeedSources',
    'jobVectors',
    'socialSources',
    'socialPosts',
    'jobFeedStates',
    'jobFeedVariants',
    'jobFeedFingerprints',
    'jobFeedRuns',
    'jobEngineState',
    'paymentEvents',
    'payments',
    'workerRuns',
    'queue',
    'cvs',
    'cvDocuments',
    'cvDeletionReceipts',
    'atsCvDrafts',
    'studentPreferences',
    'automationPreferences',
    'occupationFamilies',
    'locations',
    'skills',
    'studentOnboarding',
    'candidateConsents',
    'candidateConsentEvents',
    'cvVersions',
    'templateVersions',
    'savedSearches',
    'searchAlerts',
    'notificationPreferences',
    'entitlementUsage',
    'mailboxConnections',
    'mailOauthStates',
    'leadNotes',
  ])
    await db.collection(c).createIndex({ id: 1 }, { unique: true });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('jobs').createIndex({ status: 1, sourcePostedAt: -1, discoveredAt: -1, id: 1 });
  await db.collection('jobs').createIndex({ status: 1, country: 1, category: 1, mode: 1 });
  await db.collection('jobFeedVariants').createIndex({ sourceId: 1, active: 1, id: 1 });
  await db.collection('jobFeedVariants').createIndex({ jobId: 1, active: 1 });
  await db.collection('jobFeedRuns').createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
  await db.collection('studentOnboarding').createIndex({ userId: 1 }, { unique: true });
  await db.collection('studentPreferences').createIndex({ userId: 1 }, { unique: true });
  await db.collection('automationPreferences').createIndex({ userId: 1 }, { unique: true });
  await db.collection('occupationFamilies').createIndex({ slug: 1 }, { unique: true });
  await db.collection('skills').createIndex({ slug: 1 }, { unique: true });
  await db.collection('occupationFamilies').createIndex({ parentId: 1, active: 1 });
  await db.collection('locations').createIndex({ slug: 1 }, { unique: true });
  await db.collection('locations').createIndex({ countryCode: 1, code: 1 }, { unique: true });
  await db.collection('locations').createIndex({ parentId: 1, active: 1 });
  await db.collection('locations').createIndex({ countryCode: 1, type: 1, active: 1 });
  await db.collection('candidateConsents').createIndex({ userId: 1, purpose: 1 }, { unique: true });
  await db.collection('candidateConsentEvents').createIndex({ userId: 1, updatedAt: -1 });
  await db.collection('cvDocuments').createIndex({ userId: 1, createdAt: -1 });
  await db.collection('cvDocuments').createIndex({ userId: 1, sha256: 1 });
  await db.collection('cvDocuments').createIndex({ status: 1, updatedAt: 1 });
  await db.collection('cvDocuments').createIndex({ expiresAt: 1 });
  await db.collection('cvDeletionReceipts').createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
  await db.collection('atsCvDrafts').createIndex({ userId: 1, createdAt: -1 });
  await db.collection('cvDocuments').createIndex({ status: 1, leaseUntil: 1 });
  await db.collection('cvVersions').createIndex({ userId: 1, documentId: 1 });
  await db.collection('users').createIndex({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } });
  await db.collection('mailboxConnections').createIndex({ userId: 1 }, { unique: true });
  await db.collection('mailboxConnections').createIndex({ provider: 1, providerSubject: 1 }, { unique: true });
  await db.collection('mailOauthStates').createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
  await db.collection('oauthStates').createIndex({ id: 1 }, { unique: true });
  await db.collection('oauthStates').createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
  await db.collection('users').createIndex({ role: 1, disabled: 1, id: 1 });
  await db.collection('sessions').createIndex({ userId: 1, id: 1 });
  await db
    .collection('passwordResets')
    .createIndex({ userId: 1 }, { unique: true });
  for (const c of ['passwordResets', 'verifications', 'rateLimits'])
    await db
      .collection(c)
      .createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
  await db.collection('auditLogs').createIndex({ actorId: 1, createdAt: -1 });
  for (const collection of [
    'cvVersions',
    'templateVersions',
    'savedSearches',
    'notifications',
  ])
    await db.collection(collection).createIndex({ userId: 1, createdAt: -1 });
  await db.collection('jobs').createIndex({ status: 1, discoveredAt: -1 });
  await db
    .collection('jobs')
    .createIndex({ country: 1, category: 1, mode: 1, status: 1 });
  await db
    .collection('applications')
    .createIndex({ userId: 1, jobId: 1 }, { unique: true });
  await db
    .collection('applications')
    .createIndex({ employerId: 1, createdAt: -1 });
  await db.collection('applications').createIndex({ userId: 1, createdAt: -1 });
  await db
    .collection('sessions')
    .createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
}
