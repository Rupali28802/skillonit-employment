import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { CvObjectStorage } from './cv-providers.js';
import { module2Config, CvProviderError } from './module2-config.js';

const driveApi = 'https://www.googleapis.com/drive/v3';
const driveUploadApi = 'https://www.googleapis.com/upload/drive/v3';
const tokenApi = 'https://oauth2.googleapis.com/token';
const objectKey = (key: string) => {
  if (!/^cv\/[a-zA-Z0-9_-]{1,100}\/[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new CvProviderError('STORAGE_KEY');
  return key;
};
const configSchema = z.object({
  clientId: z.string().min(1), clientSecret: z.string().min(1), refreshToken: z.string().min(1),
  folderId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/), account: z.email().toLowerCase(),
}).strict();
export type GoogleDriveStorageConfig = z.infer<typeof configSchema>;
type Fetch = typeof fetch;

async function boundedBody(response: Response) {
  if (!response.ok || !response.body) throw new Error();
  const advertised = Number(response.headers.get('content-length') ?? 0);
  if (advertised > module2Config().CV_MAX_BYTES) throw new Error();
  const chunks: Uint8Array[] = []; let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > module2Config().CV_MAX_BYTES) { await response.body.cancel().catch(() => {}); throw new Error(); } chunks.push(chunk); }
  return Buffer.concat(chunks);
}

/** Private Drive storage using a dedicated drive.file OAuth grant. No public URLs are created or returned. */
export function googleDriveStorage(input: GoogleDriveStorageConfig, request: Fetch = fetch): CvObjectStorage & { check(): Promise<void> } {
  const config = configSchema.parse(input); let cached: { token: string; expiresAt: number } | undefined;
  const timeout = () => AbortSignal.timeout(module2Config().CV_PROVIDER_TIMEOUT_MS);
  async function token() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await request(tokenApi, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken, grant_type: 'refresh_token' }), redirect: 'error', signal: timeout() });
    if (!response.ok) throw new Error();
    const result = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive() }).passthrough().parse(await response.json()); cached = { token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 }; return cached.token;
  }
  async function call(url: string, init: RequestInit = {}) { return request(url, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...init.headers }, redirect: 'error', signal: timeout() }); }
  async function folderPolicy() {
    const fields = encodeURIComponent('id,mimeType,trashed,capabilities(canAddChildren),permissions(type,role,emailAddress,domain)');
    const response = await call(`${driveApi}/files/${config.folderId}?supportsAllDrives=true&fields=${fields}`); if (!response.ok) throw new Error();
    return z.object({ id: z.string(), mimeType: z.literal('application/vnd.google-apps.folder'), trashed: z.literal(false), capabilities: z.object({ canAddChildren: z.literal(true) }), permissions: z.array(z.object({ type: z.string(), role: z.string(), emailAddress: z.string().optional(), domain: z.string().optional() }).passthrough()).default([]) }).passthrough().parse(await response.json());
  }
  async function find(key: string) {
    const q = `'${config.folderId}' in parents and trashed = false and appProperties has { key='skillonitObjectKey' and value='${objectKey(key)}' }`;
    const response = await call(`${driveApi}/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=2&fields=${encodeURIComponent('files(id,size,mimeType,trashed)')}`); if (!response.ok) throw new Error();
    const files = z.object({ files: z.array(z.object({ id: z.string(), size: z.string().regex(/^\d+$/).optional(), mimeType: z.string(), trashed: z.boolean() }).passthrough()).max(2) }).parse(await response.json()).files;
    if (files.length > 1) throw new Error(); return files[0];
  }
  function multipart(key: string, bytes: Uint8Array, contentType: string, create: boolean) {
    const boundary = `skillonit-${randomUUID()}`, metadata = JSON.stringify({ name: `cv-${key.split('/').at(-1)}`, ...(create ? { parents: [config.folderId] } : {}), mimeType: contentType, appProperties: { skillonitObjectKey: key, skillonitPurpose: 'candidate-cv' } });
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`), Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return { boundary, body };
  }
  return {
    async check() { try { const about = await call(`${driveApi}/about?fields=${encodeURIComponent('user(emailAddress)')}`); if (!about.ok) throw new Error(); const owner = z.object({ user: z.object({ emailAddress: z.email().toLowerCase() }) }).parse(await about.json()); if (owner.user.emailAddress !== config.account) throw new Error(); const folder = await folderPolicy(); if (folder.permissions.some(permission => permission.type === 'anyone' || permission.type === 'domain')) throw new Error(); } catch { throw new CvProviderError('STORAGE_POLICY_FAILED'); } },
    async put(key, bytes, contentType) { try { objectKey(key); if (!bytes.length || bytes.length > module2Config().CV_MAX_BYTES) throw new Error(); await folderPolicy(); const existing = await find(key), data = multipart(key, bytes, contentType, !existing), url = existing ? `${driveUploadApi}/files/${existing.id}?uploadType=multipart&supportsAllDrives=true&fields=id` : `${driveUploadApi}/files?uploadType=multipart&supportsAllDrives=true&fields=id`; const response = await call(url, { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${data.boundary}` }, body: data.body }); if (!response.ok) throw new Error(); z.object({ id: z.string().min(1) }).parse(await response.json()); } catch { throw new CvProviderError('STORAGE_FAILED'); } },
    async get(key) { try { const file = await find(objectKey(key)); if (!file || file.trashed || Number(file.size ?? 0) > module2Config().CV_MAX_BYTES) throw new Error(); return await boundedBody(await call(`${driveApi}/files/${file.id}?alt=media&supportsAllDrives=true`)); } catch { throw new CvProviderError('STORAGE_FAILED'); } },
    async delete(key) { try { const file = await find(objectKey(key)); if (!file) return; const response = await call(`${driveApi}/files/${file.id}?supportsAllDrives=true`, { method: 'DELETE' }); if (!response.ok && response.status !== 404) throw new Error(); } catch { throw new CvProviderError('STORAGE_DELETE_FAILED'); } },
  };
}
