import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkModule2 } from './module2-checks.js';

test('Module 2 onboarding, preferences, consent, CV lifecycle and ownership', async () => {
  const previous = process.cwd(), env = { ...process.env };
  const dir = await mkdtemp(path.join(tmpdir(), 'skillonit-module2-'));
  try {
    process.chdir(dir); delete process.env.MONGODB_URI;
    process.env.DEMO_MODE = 'true'; process.env.APP_URL = 'http://localhost:3000';
    await checkModule2();
  } finally {
    process.chdir(previous); process.env = env;
    if (path.dirname(dir) === path.resolve(tmpdir()) && path.basename(dir).startsWith('skillonit-module2-')) await rm(dir, { recursive: true, force: true });
  }
});
