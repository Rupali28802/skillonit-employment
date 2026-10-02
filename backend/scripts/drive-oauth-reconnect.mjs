import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, chmod, copyFile } from 'node:fs/promises';

const port = 53682;
const redirectUri = `http://localhost:${port}/callback`;
const clientId = process.env.CV_GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.CV_GOOGLE_DRIVE_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error('DRIVE_OAUTH_CLIENT_CONFIG_MISSING');
const state = randomBytes(32).toString('base64url');
const verifier = randomBytes(64).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state, code_challenge: challenge, code_challenge_method: 'S256' })) authorize.searchParams.set(key, value);
console.log(`AUTHORIZATION_URL=${authorize.href}`);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', redirectUri);
    if (url.pathname !== '/callback') { response.writeHead(404).end('Not found'); return; }
    const returnedState = Buffer.from(url.searchParams.get('state') || '');
    const expectedState = Buffer.from(state);
    if (returnedState.length !== expectedState.length || !timingSafeEqual(returnedState, expectedState)) throw new Error('OAUTH_STATE_INVALID');
    const code = url.searchParams.get('code'); if (!code) throw new Error('OAUTH_CODE_MISSING');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }) });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.refresh_token) throw new Error('OAUTH_TOKEN_EXCHANGE_FAILED');
    const granted = new Set(String(token.scope || '').split(/\s+/).filter(Boolean));
    if (!granted.has('https://www.googleapis.com/auth/drive.file') || [...granted].some(scope => scope !== 'https://www.googleapis.com/auth/drive.file')) throw new Error('OAUTH_SCOPE_MISMATCH');
    const envPath = '.env'; const source = await readFile(envPath, 'utf8');
    const backup = `.env.before-drive-reconnect-${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}`;
    await copyFile(envPath, backup);
    const lines = source.split(/\r?\n/).filter(line => !line.startsWith('CV_GOOGLE_DRIVE_REFRESH_TOKEN='));
    lines.push(`CV_GOOGLE_DRIVE_REFRESH_TOKEN=${token.refresh_token}`);
    await writeFile(envPath, lines.join('\n').replace(/\n+$/, '') + '\n', { mode: 0o600 }); await chmod(envPath, 0o600);
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('SkillOnIT CV Drive authorization completed. You can close this tab.');
    console.log('DRIVE_REFRESH_TOKEN_STORED');
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('SkillOnIT CV Drive authorization failed. No credential was changed.');
    console.error('DRIVE_OAUTH_RECONNECT_FAILED'); process.exitCode = 1;
  } finally { server.close(); }
});
server.listen(port, '127.0.0.1', () => console.log(`CALLBACK_LISTENING=${port}`));
setTimeout(() => { console.error('DRIVE_OAUTH_RECONNECT_TIMEOUT'); server.close(); process.exitCode = 1; }, 10 * 60_000).unref();
