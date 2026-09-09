import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkStudentProfile } from './student-profile-checks.js';

test('student profile HTTP ownership, confirmation, revisions and concurrent edits', async () => {
  const previous = process.cwd(), env = { ...process.env };
  const dir = await mkdtemp(path.join(tmpdir(), 'skillonit-profile-'));
  try {
    process.chdir(dir); delete process.env.MONGODB_URI;
    process.env.DEMO_MODE = 'true'; process.env.APP_URL = 'http://localhost:3000';
    await checkStudentProfile();
  } finally {
    process.chdir(previous); process.env = env;
    if (path.dirname(dir) === path.resolve(tmpdir()) && path.basename(dir).startsWith('skillonit-profile-'))
      await rm(dir, { recursive: true, force: true });
  }
});
