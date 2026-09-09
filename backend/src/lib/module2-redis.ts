import { Redis, type RedisOptions } from 'ioredis';
import { z } from 'zod';

export function redisSettings(env = process.env): RedisOptions {
  try {
    const url = new URL(env.REDIS_URL || '');
    if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || url.search || url.hash || !/^\/(?:[0-9]+)?$/.test(url.pathname || '/')) throw new Error();
    if (env.NODE_ENV === 'production' && url.protocol !== 'rediss:') throw new Error();
    const timeout = z.coerce.number().int().min(100).max(30000).default(5000).parse(env.REDIS_CONNECT_TIMEOUT_MS);
    const retries = z.coerce.number().int().min(0).max(10).default(3).parse(env.REDIS_CONNECT_RETRIES);
    const db = Number(url.pathname.slice(1) || 0);
    if (!Number.isSafeInteger(db) || db < 0) throw new Error();
    return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 6379), db,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      connectTimeout: timeout, lazyConnect: true, enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      retryStrategy: attempt => attempt > retries ? null : Math.min(250 * 2 ** (attempt - 1), 3000),
    };
  } catch { throw new Error('INVALID_CONFIG: REDIS_URL / REDIS_CONNECT_TIMEOUT_MS / REDIS_CONNECT_RETRIES'); }
}
export function createModule2Redis(env = process.env) {
  const redis = new Redis(redisSettings(env));
  // Raw Redis errors can contain endpoints or authentication details.
  redis.on('error', () => {});
  return redis;
}
export async function deadline<T>(work: Promise<T>, ms: number, code: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(code)), ms); })]); }
  catch { throw new Error(code); }
  finally { clearTimeout(timer); }
}
export async function checkModule2Redis(env = process.env) {
  const redis = createModule2Redis(env);
  try {
    await deadline(redis.connect(), 15000, 'REDIS_UNAVAILABLE');
    if (await deadline(redis.ping(), 5000, 'REDIS_UNAVAILABLE') !== 'PONG') throw new Error('REDIS_UNAVAILABLE');
    return { connected: true as const };
  } finally { redis.disconnect(); }
}
