import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { googleDriveStorage } from '../dist/lib/google-drive-storage.js';

const required = [
  'CV_GOOGLE_DRIVE_CLIENT_ID',
  'CV_GOOGLE_DRIVE_CLIENT_SECRET',
  'CV_GOOGLE_DRIVE_REFRESH_TOKEN',
  'CV_GOOGLE_DRIVE_FOLDER_ID',
  'CV_GOOGLE_DRIVE_ACCOUNT',
];

if (required.some(key => !process.env[key]?.trim())) {
  console.log(JSON.stringify({ configuration: 'FAIL' }));
  process.exit(1);
}

const storage = googleDriveStorage({
  clientId: process.env.CV_GOOGLE_DRIVE_CLIENT_ID,
  clientSecret: process.env.CV_GOOGLE_DRIVE_CLIENT_SECRET,
  refreshToken: process.env.CV_GOOGLE_DRIVE_REFRESH_TOKEN,
  folderId: process.env.CV_GOOGLE_DRIVE_FOLDER_ID,
  account: process.env.CV_GOOGLE_DRIVE_ACCOUNT,
});

const key = `cv/provider-check/${randomUUID()}`;
const content = Buffer.from(`SkillOnIT controlled Drive check ${randomUUID()}\n`, 'utf8');
const report = { policy: false, upload: false, read: false, delete: false };

try {
  await storage.check();
  report.policy = true;
  await storage.put(key, content, 'text/plain');
  report.upload = true;
  assert.deepEqual(Buffer.from(await storage.get(key)), content);
  report.read = true;
  await storage.delete(key);
  report.delete = true;
} finally {
  if (!report.delete) await storage.delete(key).catch(() => {});
  console.log(JSON.stringify(report));
}

if (Object.values(report).some(value => !value)) process.exitCode = 1;
