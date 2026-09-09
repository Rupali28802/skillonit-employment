import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkModule2Foundation } from './module2-foundation-checks.js';
test('Module 2 preferences, catalogs, onboarding, consent, automation configuration and completion', async () => {
  const cwd = process.cwd(), env = { ...process.env }, dir = await mkdtemp(path.join(tmpdir(), 'skillonit-foundation-'));
  try { process.chdir(dir); delete process.env.MONGODB_URI; process.env.DEMO_MODE = 'true'; process.env.APP_URL = 'http://localhost:3000'; await checkModule2Foundation(); }
  finally { process.chdir(cwd); process.env = env; if (path.dirname(dir) === path.resolve(tmpdir()) && path.basename(dir).startsWith('skillonit-foundation-')) await rm(dir, { recursive: true, force: true }); }
});
