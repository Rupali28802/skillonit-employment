import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleDriveStorage } from '../src/lib/google-drive-storage.js';

const config = { clientId: 'fixture-client', clientSecret: 'fixture-secret', refreshToken: 'fixture-refresh', folderId: 'private_folder_12345', account: 'skillonitemployment@gmail.com' };

function driveDouble(options: { publicFolder?: boolean; wrongAccount?: boolean } = {}) {
  let stored = Buffer.alloc(0), fileExists = false, deleted = false;
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const request = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input), method = init.method ?? 'GET';
    calls.push({ url, method, body: typeof init.body === 'string' ? init.body : undefined });
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'fixture-access', expires_in: 3600 });
    if (url.includes('/about?')) return Response.json({ user: { emailAddress: options.wrongAccount ? 'wrong@example.test' : config.account } });
    if (url.includes(`/files/${config.folderId}?`)) return Response.json({ id: config.folderId, mimeType: 'application/vnd.google-apps.folder', trashed: false, capabilities: { canAddChildren: true }, permissions: options.publicFolder ? [{ type: 'anyone', role: 'reader' }] : [{ type: 'user', role: 'owner', emailAddress: config.account }] });
    if (url.includes('/files?q=')) return Response.json({ files: fileExists && !deleted ? [{ id: 'drive_file_123', size: String(stored.length), mimeType: 'application/pdf', trashed: false }] : [] });
    if (url.includes('/upload/drive/v3/files')) {
      const bytes = Buffer.from(init.body as Uint8Array); const marker = Buffer.from('\r\n--skillonit-'); const contentStart = bytes.indexOf(Buffer.from('\r\n\r\n'), bytes.indexOf(Buffer.from('Content-Type: application/pdf'))) + 4; const contentEnd = bytes.indexOf(marker, contentStart);
      stored = bytes.subarray(contentStart, contentEnd); fileExists = true; deleted = false; return Response.json({ id: 'drive_file_123' });
    }
    if (url.includes('/files/drive_file_123?alt=media')) return new Response(stored, { headers: { 'content-length': String(stored.length) } });
    if (url.includes('/files/drive_file_123?') && method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
    return new Response(null, { status: 404 });
  };
  return { request: request as typeof fetch, calls, deleted: () => deleted };
}

test('Google Drive storage verifies account/private folder and performs private lifecycle', async () => {
  const fake = driveDouble(); const storage = googleDriveStorage(config, fake.request);
  await storage.check();
  await storage.put('cv/user_1/document_1', Buffer.from('private-cv'), 'application/pdf');
  assert.equal(Buffer.from(await storage.get('cv/user_1/document_1')).toString(), 'private-cv');
  await storage.delete('cv/user_1/document_1'); assert.equal(fake.deleted(), true);
  assert.equal(fake.calls.some(call => call.url.includes('/permissions') || call.url.includes('webViewLink')), false);
  assert.equal(JSON.stringify(fake.calls).includes('fixture-secret'), false);
  assert.equal(JSON.stringify(fake.calls).includes('fixture-refresh'), false);
});

test('Google Drive storage rejects wrong account, public folders and unsafe object keys', async () => {
  await assert.rejects(googleDriveStorage(config, driveDouble({ wrongAccount: true }).request).check(), { code: 'STORAGE_POLICY_FAILED' });
  await assert.rejects(googleDriveStorage(config, driveDouble({ publicFolder: true }).request).check(), { code: 'STORAGE_POLICY_FAILED' });
  await assert.rejects(googleDriveStorage(config, driveDouble().request).get('../secret'), { code: 'STORAGE_FAILED' });
});
