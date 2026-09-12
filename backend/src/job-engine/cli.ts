import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { bootstrapIndexes, closeStore, read, transaction } from '../lib/store.js';
import { runEngine, upsertSource, engineStatus, setEmployerRefresh } from './engine.js';
import { publicSources, worldwideSources, configuredJoobleSources, sourceSchema } from './sources.js';
import { coverageReport, saveCoverageAudit } from './coverage.js';
import { indexSemantic } from './semantic.js';

let stopping = false;
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stopping = true; });
try {
  if (!process.env.MONGODB_URI) throw Error('MONGODB_REQUIRED');
  await bootstrapIndexes();
  const command = process.argv[2] || 'status';
  if (command === 'watch-semantic') {
    do {
      try { const indexed = await indexSemantic(100); if(indexed) console.log(JSON.stringify({indexed})); }
      catch { console.error('SEMANTIC_INDEX_FAILED'); }
      for(let i=0;i<30&&!stopping;i++) await delay(1000);
    } while(!stopping);
  } else if (command === 'index-semantic') {
    console.log(JSON.stringify({indexed:await indexSemantic(10000)}));
  } else if (command === 'refresh-employers') {
    const interval = Number(process.argv[3] || 10);
    if (![5, 10].includes(interval)) throw Error('USE_FIVE_OR_TEN_MINUTES');
    const sources = await read(r => r.find<{ id: string }>('jobFeedSources', { type: { $in: ['ashby', 'greenhouse', 'lever'] }, enabled: true, approved: true, publicListing: true }, 1000));
    for (const source of sources) await setEmployerRefresh(source.id, interval);
    console.log(JSON.stringify({ sources: sources.map(s => s.id), intervalMinutes: interval }));
  } else if (command === 'seed-employers') {
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
    let recordingHeartbeat=false;
    const heartbeat=async()=>{
      if(recordingHeartbeat)return;
      recordingHeartbeat=true;
      try {await transaction(r=>r.put('jobEngineState',{id:'discovery-heartbeat',updatedAt:new Date().toISOString(),status:'running'}));}
      catch {console.error('DISCOVERY_HEARTBEAT_FAILED');}
      finally {recordingHeartbeat=false;}
    };
    const heartbeatTimer=command==='watch'?setInterval(()=>void heartbeat(),30000):undefined;
    heartbeatTimer?.unref();
    try {
    do {
      if(command==='watch') await heartbeat();
      const result = await runEngine(undefined, command === 'once-jooble' ? 'jooble' : undefined);
      const changed = result.results.filter(r => r.counts || r.status === 'failed' || r.status === 'invalid_configuration');
      if (changed.length || result.expired) {
        try { await saveCoverageAudit(); }
        catch { console.error('COVERAGE_AUDIT_FAILED: ingestion result preserved; retry coverage export.'); }
      }
      if (command !== 'watch') console.log(JSON.stringify(result));
      else if (changed.length || result.expired) console.log(JSON.stringify({ ...result, results: changed }));
      if (command !== 'watch') break;
      for (let i = 0; i < 30 && !stopping; i++) await delay(1000);
    } while (!stopping);
    } finally {if(heartbeatTimer)clearInterval(heartbeatTimer);}
  } else throw Error('UNKNOWN_COMMAND');
} catch {
  console.error('Job engine failed. Check MongoDB, source configuration and saved source status; private connection details withheld.');
  process.exitCode = 1;
} finally { await closeStore(); }
