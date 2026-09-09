import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, GetPublicAccessBlockCommand, GetBucketVersioningCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { profileSchema } from './schemas.js';
import type { CvProviders } from './cv-providers.js';
import { module2Config, CvProviderError } from './module2-config.js';

const https = z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; });
export function cvProductionConfig(env = process.env) {
  return z.object({ CV_STORAGE_PROVIDER: z.literal('s3'), CV_S3_BUCKET: z.string().min(3).max(63), CV_S3_REGION: z.string().min(1), CV_S3_ENDPOINT: https.optional(), CV_SCANNER_PROVIDER: z.literal('https'), CV_SCANNER_URL: https, CV_SCANNER_TOKEN: z.string().min(1), CV_PARSER_PROVIDER: z.literal('https'), CV_PARSER_URL: https, CV_PARSER_TOKEN: z.string().min(1), CV_PARSER_VERSION: z.string().min(1).max(100) }).parse(env);
}
function objectKey(key: string) { if (!/^cv\/[a-zA-Z0-9_-]{1,100}\/[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new CvProviderError('STORAGE_KEY'); return key; }
async function jsonService(url: string, token: string, bytes: Uint8Array, contentType: string, operation: string) {
  try {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': contentType }, body: Buffer.from(bytes), redirect: 'error', signal: AbortSignal.timeout(module2Config().CV_PROVIDER_TIMEOUT_MS) });
    if (!response.ok || !response.body) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 131072) { await response.body.cancel().catch(() => {}); throw new Error(); } chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch { throw new CvProviderError(operation + '_FAILED'); }
}
/** Server-side private S3 access; no public URLs or arbitrary keys leave the adapter. */
export function productionCvProviders(clientOverride?: S3Client): CvProviders & { check(): Promise<void> } {
  const config = cvProductionConfig();
  const client = clientOverride ?? new S3Client({ region: config.CV_S3_REGION, endpoint: config.CV_S3_ENDPOINT, forcePathStyle: !!config.CV_S3_ENDPOINT, maxAttempts: 2 });
  const options = () => ({ abortSignal: AbortSignal.timeout(module2Config().CV_PROVIDER_TIMEOUT_MS) });
  return {
    async check() {
      try {
        const access = (await client.send(new GetPublicAccessBlockCommand({ Bucket: config.CV_S3_BUCKET }), options())).PublicAccessBlockConfiguration;
        if (!access || !access.BlockPublicAcls || !access.IgnorePublicAcls || !access.BlockPublicPolicy || !access.RestrictPublicBuckets) throw new Error();
        // Exact deletion semantics: versioned buckets require a separate version-aware adapter.
        if ((await client.send(new GetBucketVersioningCommand({ Bucket: config.CV_S3_BUCKET }), options())).Status) throw new Error();
      } catch { throw new CvProviderError('STORAGE_POLICY_FAILED'); }
    },
    storage: {
      async put(key, bytes, contentType) { try { await client.send(new PutObjectCommand({ Bucket: config.CV_S3_BUCKET, Key: objectKey(key), Body: bytes, ContentType: contentType, ServerSideEncryption: 'AES256' }), options()); } catch { throw new CvProviderError('STORAGE_FAILED'); } },
      async get(key) {
        try {
          const response = await client.send(new GetObjectCommand({ Bucket: config.CV_S3_BUCKET, Key: objectKey(key) }), options());
          if (!response.Body || (response.ContentLength ?? 0) > module2Config().CV_MAX_BYTES) throw new Error();
          const chunks: Uint8Array[] = []; let size = 0;
          for await (const chunk of response.Body as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > module2Config().CV_MAX_BYTES) throw new Error(); chunks.push(chunk); }
          return Buffer.concat(chunks);
        } catch { throw new CvProviderError('STORAGE_FAILED'); }
      },
      async delete(key) { try { await client.send(new DeleteObjectCommand({ Bucket: config.CV_S3_BUCKET, Key: objectKey(key) }), options()); } catch { throw new CvProviderError('STORAGE_DELETE_FAILED'); } },
    },
    scanner: { async scan(bytes, contentType) { const result = z.object({ status: z.enum(['CLEAN', 'INFECTED']) }).strict().parse(await jsonService(config.CV_SCANNER_URL, config.CV_SCANNER_TOKEN, bytes, contentType, 'SCANNER')); return result.status === 'CLEAN' ? 'clean' : 'rejected'; } },
    parser: { version: config.CV_PARSER_VERSION, async extract(bytes, contentType) {
      const result = z.object({ version: z.literal(config.CV_PARSER_VERSION), facts: profileSchema.partial().omit({ confirmed: true }).strict() }).strict().parse(await jsonService(config.CV_PARSER_URL, config.CV_PARSER_TOKEN, bytes, contentType, 'PARSER'));
      return result.facts;
    } },
  };
}
