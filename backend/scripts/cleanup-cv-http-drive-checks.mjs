import { googleDriveStorage } from '../dist/lib/google-drive-storage.js';
import { cvProductionConfig } from '../dist/lib/cv-production.js';

const config = cvProductionConfig();
const storage = googleDriveStorage({ clientId: config.CV_GOOGLE_DRIVE_CLIENT_ID, clientSecret: config.CV_GOOGLE_DRIVE_CLIENT_SECRET, refreshToken: config.CV_GOOGLE_DRIVE_REFRESH_TOKEN, folderId: config.CV_GOOGLE_DRIVE_FOLDER_ID, account: config.CV_GOOGLE_DRIVE_ACCOUNT });
const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.CV_GOOGLE_DRIVE_CLIENT_ID, client_secret: config.CV_GOOGLE_DRIVE_CLIENT_SECRET, refresh_token: config.CV_GOOGLE_DRIVE_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
if (!tokenResponse.ok) throw new Error('DRIVE_AUTH_FAILED');
const token = (await tokenResponse.json()).access_token;
const query = `'${config.CV_GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed = false`;
const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,appProperties)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
if (!response.ok) throw new Error('DRIVE_LIST_FAILED');
const files = (await response.json()).files || [];
let removed = 0;
for (const file of files) {
  const key = file.appProperties?.skillonitObjectKey || '';
  if (!key.startsWith('cv/cv-http-check-')) continue;
  await storage.delete(key); removed += 1;
}
console.log(JSON.stringify({ staleControlledFilesRemoved: removed }));
