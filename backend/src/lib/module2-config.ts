import { z } from 'zod';
import { ApiError, rateLimit } from './security.js';
const integer = (fallback: number, max: number) => z.coerce.number().int().min(1).max(max).default(fallback);
export function module2Config(env = process.env) {
  return z.object({
    CV_MAX_BYTES: integer(5242880, 10485760), CV_PROVIDER_TIMEOUT_MS: integer(15000, 60000),
    CV_ALLOWED_FORMATS: z.enum(['pdf', 'docx', 'pdf,docx']).default('pdf,docx'),
    CV_MAX_ATTEMPTS: integer(3, 10), CV_RETENTION_DAYS: integer(90, 3650),
    MODULE2_MUTATIONS_PER_MINUTE: integer(60, 300), MODULE2_LOOKUPS_PER_MINUTE: integer(120, 600),
    MODULE2_ADMIN_PER_MINUTE: integer(10, 60), CV_UPLOADS_PER_MINUTE: integer(5, 30),
    AUTOMATION_MAX_DAILY_CAP: integer(100, 100),
  }).parse(env);
}
export async function module2Limit(userId: string, operation: 'mutation' | 'lookup' | 'admin' | 'upload') {
  const c = module2Config();
  await rateLimit('module2:' + operation + ':' + userId, { mutation: c.MODULE2_MUTATIONS_PER_MINUTE, lookup: c.MODULE2_LOOKUPS_PER_MINUTE, admin: c.MODULE2_ADMIN_PER_MINUTE, upload: c.CV_UPLOADS_PER_MINUTE }[operation]);
}
export class CvProviderError extends ApiError {
  constructor(code: string) { super(503, code, 'The CV provider could not complete this operation. Retry later.'); }
}
export async function bounded<T>(work: Promise<T>, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CvProviderError(code)), module2Config().CV_PROVIDER_TIMEOUT_MS); })]); }
  catch { throw new CvProviderError(code); }
  finally { if (timer) clearTimeout(timer); }
}
