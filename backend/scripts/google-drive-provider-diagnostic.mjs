const required = ['CV_GOOGLE_DRIVE_CLIENT_ID', 'CV_GOOGLE_DRIVE_CLIENT_SECRET', 'CV_GOOGLE_DRIVE_REFRESH_TOKEN', 'CV_GOOGLE_DRIVE_FOLDER_ID', 'CV_GOOGLE_DRIVE_ACCOUNT'];
if (required.some(key => !process.env[key]?.trim())) { console.log(JSON.stringify({ configuration: 'FAIL' })); process.exit(1); }
const report = { configuration: 'PASS', token: 'NOT_RUN', oauthError: null, account: 'NOT_RUN', folder: 'NOT_RUN', accountMatch: false, privateFolder: false, canAddChildren: false };
try {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.CV_GOOGLE_DRIVE_CLIENT_ID, client_secret: process.env.CV_GOOGLE_DRIVE_CLIENT_SECRET, refresh_token: process.env.CV_GOOGLE_DRIVE_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  report.token = tokenResponse.ok ? 'PASS' : `FAIL_${tokenResponse.status}`;
  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok) { report.oauthError = String(tokenPayload?.error || 'unknown').slice(0, 80); throw new Error(); }
  const token = tokenPayload.access_token; if (!token) throw new Error();
  const headers = { Authorization: `Bearer ${token}` };
  const aboutResponse = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers });
  report.account = aboutResponse.ok ? 'PASS' : `FAIL_${aboutResponse.status}`;
  if (aboutResponse.ok) report.accountMatch = String((await aboutResponse.json())?.user?.emailAddress || '').toLowerCase() === process.env.CV_GOOGLE_DRIVE_ACCOUNT.toLowerCase();
  const fields = encodeURIComponent('id,mimeType,trashed,capabilities(canAddChildren),permissions(type,role)');
  const folderResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(process.env.CV_GOOGLE_DRIVE_FOLDER_ID)}?supportsAllDrives=true&fields=${fields}`, { headers });
  report.folder = folderResponse.ok ? 'PASS' : `FAIL_${folderResponse.status}`;
  if (folderResponse.ok) { const folder = await folderResponse.json(); report.canAddChildren = folder?.capabilities?.canAddChildren === true; report.privateFolder = Array.isArray(folder?.permissions) && !folder.permissions.some(permission => permission?.type === 'anyone' || permission?.type === 'domain'); }
} catch {}
console.log(JSON.stringify(report));
if (report.token !== 'PASS' || report.account !== 'PASS' || report.folder !== 'PASS' || !report.accountMatch || !report.privateFolder || !report.canAddChildren) process.exitCode = 1;
