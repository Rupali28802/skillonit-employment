import { z } from 'zod';
import { profileSchema } from './schemas.js';
import type { CvProviders } from './cv-providers.js';
import { module2Config, CvProviderError } from './module2-config.js';
import { googleDriveStorage } from './google-drive-storage.js';

const https = z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; });
export function cvProductionConfig(env = process.env) {
  return z.object({ CV_STORAGE_PROVIDER: z.literal('google-drive'), CV_GOOGLE_DRIVE_CLIENT_ID: z.string().min(1), CV_GOOGLE_DRIVE_CLIENT_SECRET: z.string().min(1), CV_GOOGLE_DRIVE_REFRESH_TOKEN: z.string().min(1), CV_GOOGLE_DRIVE_FOLDER_ID: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/), CV_GOOGLE_DRIVE_ACCOUNT: z.email().toLowerCase(), CV_SCANNER_PROVIDER: z.literal('cloudmersive'), CV_SCANNER_URL: https, CV_SCANNER_TOKEN: z.string().min(1), CV_PARSER_PROVIDER: z.literal('https'), CV_PARSER_URL: https, CV_PARSER_TOKEN: z.string().min(1), CV_PARSER_VERSION: z.string().min(1).max(100) }).parse(env);
}
async function jsonService(url: string, token: string, bytes: Uint8Array, contentType: string, operation: string) {
  try {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': contentType }, body: Buffer.from(bytes), redirect: 'error', signal: AbortSignal.timeout(module2Config().CV_PROVIDER_TIMEOUT_MS) });
    if (!response.ok || !response.body) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 131072) { await response.body.cancel().catch(() => {}); throw new Error(); } chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch { throw new CvProviderError(operation + '_FAILED'); }
}
async function cloudmersiveScan(url: string, token: string, bytes: Uint8Array, contentType: string) {
  try {
    const form = new FormData();
    form.set('inputFile', new Blob([Buffer.from(bytes)], { type: contentType }), contentType === 'application/pdf' ? 'candidate.pdf' : 'candidate.docx');
    const response = await fetch(url, { method: 'POST', headers: { Apikey: token }, body: form, redirect: 'error', signal: AbortSignal.timeout(module2Config().CV_PROVIDER_TIMEOUT_MS) });
    if (!response.ok) throw new Error();
    const result = z.object({ CleanResult: z.boolean() }).passthrough().parse(await response.json());
    return result.CleanResult ? 'clean' as const : 'rejected' as const;
  } catch { throw new CvProviderError('SCANNER_FAILED'); }
}
/** Private Google Drive storage plus the existing HTTPS scanner/parser adapters. */
export function productionCvProviders(fetchOverride?: typeof fetch): CvProviders & { check(): Promise<void> } {
  const config = cvProductionConfig();
  const storage = googleDriveStorage({ clientId: config.CV_GOOGLE_DRIVE_CLIENT_ID, clientSecret: config.CV_GOOGLE_DRIVE_CLIENT_SECRET, refreshToken: config.CV_GOOGLE_DRIVE_REFRESH_TOKEN, folderId: config.CV_GOOGLE_DRIVE_FOLDER_ID, account: config.CV_GOOGLE_DRIVE_ACCOUNT }, fetchOverride);
  return {
    check: storage.check,
    storage,
    scanner: { async scan(bytes, contentType) { return cloudmersiveScan(config.CV_SCANNER_URL, config.CV_SCANNER_TOKEN, bytes, contentType); } },
    parser: { version: config.CV_PARSER_VERSION, async extract(bytes, contentType) {
      const result = z.object({ version: z.literal(config.CV_PARSER_VERSION), facts: profileSchema.partial().omit({ confirmed: true }).strict() }).strict().parse(await jsonService(config.CV_PARSER_URL, config.CV_PARSER_TOKEN, bytes, contentType, 'PARSER'));
      return result.facts;
    } },
  };
}
