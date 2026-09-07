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
export type Row = { id: string; [key: string]: unknown };
export const demoMode = () => process.env.DEMO_MODE === 'true';
type Query = Record<string, unknown>;
export interface Repository {
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
  return {
    async find<T>(c: string, q: Query = {}, limit = 100) {
      return Object.values(data[c] || {})
        .filter((r) => Object.entries(q).every(([k, v]) => r[k] === v))
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
  const db = mongo().db(process.env.MONGODB_DATABASE || 'skillonit');
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
    'applicationTemplates',
    'notifications',
    'fraudReports',
    'jobSources',
    'paymentEvents',
    'payments',
    'workerRuns',
    'queue',
    'cvs',
  ])
    await db.collection(c).createIndex({ id: 1 }, { unique: true });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
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
  await db
    .collection('sessions')
    .createIndex({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });
}
