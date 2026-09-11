import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { bootstrapIndexes, closeStore, read, transaction } from '../lib/store.js';
import { runEngine, upsertSource, engineStatus } from './engine.js';
import { publicSources, worldwideSources, configuredJoobleSources, sourceSchema } from './sources.js';
import { coverageReport } from './coverage.js';

let stopping = false;
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stopping = true; });
try {
  if (!process.env.MONGODB_URI) throw Error('MONGODB_REQUIRED');
  await bootstrapIndexes();
  const command = process.argv[2] || 'status';
  if (command === 'seed-employers') {
    const configs = JSON.parse(await readFile(new URL('../../job-sources.employers.json', import.meta.url), 'utf8'));
    for (const input of configs) {
      const source = sourceSchema.parse(input);
      if (!(await read(r => r.get('jobFeedSources', source.id)))) await upsertSource(source);
    }
    console.log('Public employer board configurations seeded; existing settings preserved.');
  } else if (command === 'seed-jooble') {
    const configured = configuredJoobleSources();
    for (const source of configured) {
      if (!(await read(r => r.get('jobFeedSources', source.id)))) await upsertSource(source);
    }
    console.log(JSON.stringify({ configuredRegions: configured.length, message: 'Existing settings preserved; credentials never stored in source records.' }));
  } else if (command === 'seed-worldwide') {
    await transaction(async r => {
      const existing = new Set((await r.find<{ id: string }>('jobFeedSources', {}, 1000)).map(s => s.id));
      const missing = worldwideSources.filter(s => !existing.has(s.id)).map(s => sourceSchema.parse(s));
      await r.putMany('jobFeedSources', missing);
      await r.putMany('jobFeedStates', missing.map(s => ({ id: s.id, nextRunAt: 0, failures: 0, status: 'ready' })));
    });
    console.log('Country search feeds configured; existing source settings preserved.');
  } else if (command === 'seed') {
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
  else if (command === 'once' || command === 'once-jooble' || command === 'watch') {
    do {
      const result = await runEngine(undefined, command === 'once-jooble' ? 'jooble' : undefined);
      const changed = result.results.filter(r => r.counts || r.status === 'failed' || r.status === 'invalid_configuration');
      if (command !== 'watch') console.log(JSON.stringify(result));
      else if (changed.length || result.expired) console.log(JSON.stringify({ ...result, results: changed }));
      if (command !== 'watch') break;
      for (let i = 0; i < 30 && !stopping; i++) await delay(1000);
    } while (!stopping);
  } else throw Error('UNKNOWN_COMMAND');
} catch {
  console.error('Job engine failed. Check MongoDB, source configuration and saved source status; private connection details withheld.');
  process.exitCode = 1;
} finally { await closeStore(); }
