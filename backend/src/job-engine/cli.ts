import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { bootstrapIndexes, closeStore, read } from '../lib/store.js';
import { runEngine, upsertSource, engineStatus } from './engine.js';
import { publicSources } from './sources.js';
import { coverageReport } from './coverage.js';

let stopping = false;
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stopping = true; });
try {
  if (!process.env.MONGODB_URI) throw Error('MONGODB_REQUIRED');
  await bootstrapIndexes();
  const command = process.argv[2] || 'status';
  if (command === 'seed') {
    for (const source of publicSources) {
      if (!(await read(r => r.get('jobFeedSources', source.id)))) await upsertSource(source);
    }
    console.log('Public feed sources configured; existing source settings preserved.');
  } else if (command === 'configure') {
    const file = process.argv[3]; if (!file) throw Error('SOURCE_CONFIG_FILE_REQUIRED');
    const source = await upsertSource(JSON.parse(await readFile(file, 'utf8')));
    console.log(JSON.stringify({ id: source.id, enabled: source.enabled }));
  } else if (command === 'coverage') console.log(JSON.stringify(await coverageReport(), null, 2));
  else if (command === 'status') console.log(JSON.stringify(await engineStatus(), null, 2));
  else if (command === 'once' || command === 'watch') {
    do {
      console.log(JSON.stringify(await runEngine()));
      if (command === 'once') break;
      for (let i = 0; i < 30 && !stopping; i++) await delay(1000);
    } while (!stopping);
  } else throw Error('UNKNOWN_COMMAND');
} catch {
  console.error('Job engine failed. Check MongoDB, source configuration and saved source status; private connection details withheld.');
  process.exitCode = 1;
} finally { await closeStore(); }
