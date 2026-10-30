import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { bootstrapIndexes, closeStore, read, transaction } from '../lib/store.js';
import { runEngine, upsertSource, engineStatus, setEmployerRefresh } from './engine.js';
import { publicSources, worldwideSources, configuredJoobleSources, configuredTheMuseSource, sourceSchema } from './sources.js';
import { coverageReport, saveCoverageAudit } from './coverage.js';
import { indexSemantic } from './semantic.js';

let stopping = false;
let coverageAuditRunning = false;
let nextCoverageAuditAt = 0;
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stopping = true; });
function scheduleCoverageAudit() {
  // Coverage is a full-inventory report. It is useful operationally, but it
  // must be scheduled as explicit maintenance rather than competing with the
  // public jobs feed after every discovery change. The most recent completed
  // report remains available through discovery status.
  if (process.env.ENABLE_COVERAGE_AUDIT !== 'true') return;
  if (coverageAuditRunning || Date.now() < nextCoverageAuditAt) return;
  coverageAuditRunning = true;
  nextCoverageAuditAt = Date.now() + 60 * 60 * 1000;
  // Coverage scans the full live inventory. It is useful monitoring, but it
  // must never hold the ten-minute ingestion loop hostage.
  void saveCoverageAudit()
    .catch(() => console.error('COVERAGE_AUDIT_FAILED: ingestion result preserved; retry coverage export.'))
    .finally(() => { coverageAuditRunning = false; });
}
try {
  if (!process.env.DATABASE_URL?.trim() && !process.env.MONGODB_URI?.trim()) throw Error('DATABASE_REQUIRED');
  const command = process.argv[2] || 'status';
  // These commands are read-only observability. Keep them available when Atlas
  // cannot create an index (for example, while a capacity incident is being repaired).
  // A credential-gated seed with no configured credential must be a no-op. It
  // should not require database mutation/index privileges merely to report that
  // the provider is pending activation.
  const noOpCredentialSeed = command === 'seed-themuse' && !process.env.THEMUSE_API_KEY?.trim();
  if (!['coverage', 'status'].includes(command) && !noOpCredentialSeed) await bootstrapIndexes();
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
  } else if (command === 'seed-themuse') {
    const configured = configuredTheMuseSource();
    for (const source of configured) {
      if (!(await read(r => r.get('jobFeedSources', source.id)))) await upsertSource(source);
    }
    console.log(JSON.stringify({ configured: configured.length, message: 'The Muse source configured only when a private registered API key is present; existing settings preserved.' }));
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
    const heartbeat=async(extra: Record<string, unknown> = {})=>{
      if(recordingHeartbeat)return;
      recordingHeartbeat=true;
      try {await transaction(async r=>{
        const current = await r.get<Record<string, unknown>>('jobEngineState','discovery-heartbeat');
        await r.put('jobEngineState',{
          ...current,
          id:'discovery-heartbeat',
          updatedAt:new Date().toISOString(),
          ...extra,
        });
      });}
      catch {console.error('DISCOVERY_HEARTBEAT_FAILED');}
      finally {recordingHeartbeat=false;}
    };
    const heartbeatTimer=command==='watch'?setInterval(()=>void heartbeat(),30000):undefined;
    heartbeatTimer?.unref();
    try {
    do {
      if(command==='watch') await heartbeat({status:'running',lastCycleStartedAt:new Date().toISOString()});
      const result = await runEngine(undefined, command === 'once-jooble' ? 'jooble' : undefined);
      if(command==='watch') await heartbeat({
        status: result.status === 'completed' ? 'idle' : result.status,
        lastCycleCompletedAt: new Date().toISOString(),
        lastCycleStatus: result.status,
        lastCycleSourcesProcessed: result.results.length,
        lastCycleChangedSources: result.results.filter(r => r.counts || r.status === 'failed' || r.status === 'invalid_configuration').length,
      });
      const changed = result.results.filter(r => r.counts || r.status === 'failed' || r.status === 'invalid_configuration');
      if (changed.length || result.expired) {
        if (command === 'watch') scheduleCoverageAudit();
        else await saveCoverageAudit();
      }
      if (command !== 'watch') console.log(JSON.stringify(result));
      else if (changed.length || result.expired) console.log(JSON.stringify({ ...result, results: changed }));
      if (command !== 'watch') break;
      for (let i = 0; i < 30 && !stopping; i++) await delay(1000);
    } while (!stopping);
    } finally {if(heartbeatTimer)clearInterval(heartbeatTimer);}
  } else throw Error('UNKNOWN_COMMAND');
} catch (error) {
  // Keep the production log actionable without printing configuration values.
  const message = error instanceof Error ? error.message.replace(/(?:mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/)[^\s]+/gi, '[connection-string-redacted]') : 'Unknown worker error';
  console.error(`Job engine failed: ${message}`);
  process.exitCode = 1;
} finally { await closeStore(); }
