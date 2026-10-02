// Opt-in verification harness. Run only against a freshly created, isolated DB.
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if (!/^skillonit_verify_[0-9]+$/.test(dbName) || process.env.VERIFY_ISOLATED_DB !== dbName) throw Error('ISOLATED_DATABASE_REQUIRED');
delete process.env.MONGODB_URI;
const { bootstrapIndexes, transaction, read, closeStore } = await import('../src/lib/store.ts');
const { runEngine, upsertSource } = await import('../src/job-engine/engine.ts');
const { syncMatchingIndex, removeDeletedIndexEntries } = await import('../src/lib/matching-indexer.ts');
const { defaultRankingPolicy } = await import('../src/lib/matching-contracts.ts');
const pool = new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:2});
const results=[];
async function check(name, fn) { try { const details=await fn(); results.push({name,result:'PASS',details}); } catch(e) { results.push({name,result:'FAIL',code:e.code,reason:e.name==='AssertionError'?e.message:'Operation failed; private details withheld'}); } console.log(JSON.stringify(results.at(-1))); }
const barrier = n => { let count=0, release; const promise=new Promise(r=>{release=r;}); return async()=>{if(++count===n)release();await promise;}; };
try {
  await bootstrapIndexes();
  await check('sequential discovery and replay', async()=>{
    await upsertSource({id:'verification-board',type:'ashby',name:'Isolated verification',company:'Isolated Employer',board:'example',enabled:true,approved:true,publicListing:true,publish:true,policyEvidence:'Isolated integration fixture; no live source requests.',intervalMinutes:30,maxPages:1});
    const candidate={externalId:'role-1',title:'Clinical nurse',company:'Isolated Employer',url:'https://careers.example.com/jobs/role-1',description:'Provide patient care and clinical support for the nursing team.',location:'London, United Kingdom',postedAt:new Date().toISOString()};
    const fetch=async()=>({jobs:[candidate],complete:true,snapshot:true,requests:1});
    const first=await runEngine(fetch); assert.equal(first.results[0]?.counts?.added,1);
    await transaction(async r=>{const state=await r.get('jobFeedStates','verification-board');await r.put('jobFeedStates',{...state,nextRunAt:0});});
    const second=await runEngine(fetch); assert.equal(second.results[0]?.counts?.added,0);
    for(const c of ['jobs','jobFeedVariants','jobFeedFingerprints'])assert.equal(await read(r=>r.count(c)),1,c);
    assert.equal(await read(r=>r.count('jobFeedRuns')),2); return {jobs:1,runs:2};
  });
  await check('transaction rollback',async()=>{await assert.rejects(transaction(async r=>{await r.put('verification',{id:'rollback'});throw Error('fixture rollback');}));assert.equal(await read(r=>r.get('verification','rollback')),null);});
  await check('concurrent distinct inserts and same-ID replay',async()=>{await Promise.all(Array.from({length:8},(_,i)=>transaction(r=>r.put('verification',{id:`distinct-${i}`,value:i}))));assert.equal(await read(r=>r.count('verification')),8);await Promise.all(Array.from({length:8},()=>transaction(r=>r.put('verification',{id:'same',value:1}))));assert.equal(await read(r=>r.count('verification',{id:'same'})),1);});
  await check('concurrent read-modify-write preserves every increment',async()=>{await transaction(r=>r.put('verification',{id:'counter',value:0}));const wait=barrier(4);await Promise.all(Array.from({length:4},()=>transaction(async r=>{const old=await r.get('verification','counter');await wait();await r.put('verification',{...old,value:old.value+1});})));const value=(await read(r=>r.get('verification','counter'))).value;assert.equal(value,4,`Expected 4 increments; observed ${value}`);});
  for(const [collection,id] of [['jobEngineState','job-engine'],['systemConfig','matching-index-lease']])await check(`exclusive concurrent lease: ${collection}`,async()=>{await transaction(r=>r.remove(collection,id));const wait=barrier(2);const acquired=await Promise.all(['worker-a','worker-b'].map(owner=>transaction(async r=>{const old=await r.get(collection,id);await wait();if(old&&old.until>Date.now())return false;await r.put(collection,{id,owner,until:Date.now()+60000});return true;})));assert.equal(acquired.filter(Boolean).length,1,`Expected one owner; ${acquired.filter(Boolean).length} workers reported acquisition`);});
  await check('matching state write/replay/delete with isolated search double',async()=>{const docs=new Map();const search={index:async j=>{docs.set(j.id,j);},remove:async id=>{docs.delete(id);}};const job=(await read(r=>r.find('jobs',{},10)))[0];assert.ok(job);await transaction(r=>r.put('jobs',{...job,trust:'verified',status:'published'}));const opts={version:'verification-v1'};const one=await read(r=>syncMatchingIndex(r,search,undefined,defaultRankingPolicy(),opts));assert.equal(one.indexed,1);const two=await read(r=>syncMatchingIndex(r,search,undefined,defaultRankingPolicy(),opts));assert.equal(two.skipped,1);assert.equal(await read(r=>r.count('matchingIndexState')),1);await transaction(r=>r.put('matchingIndexState',{id:'missing-job',fingerprint:'x',version:'verification-v1'}));await read(r=>removeDeletedIndexEntries(r,search));assert.equal(await read(r=>r.get('matchingIndexState','missing-job')),null);return {externalProvider:'test double, not production-validated'};});
  await check('required uniqueness: user email',async()=>{await transaction(r=>r.put('users',{id:'u1',email:'isolated@example.test'}));await assert.rejects(transaction(r=>r.put('users',{id:'u2',email:'isolated@example.test'})),e=>e.code==='23505');});
  await check('required uniqueness: payment provider ID',async()=>{await transaction(r=>r.put('payments',{id:'p1',providerPaymentId:'fixture-payment'}));await assert.rejects(transaction(r=>r.put('payments',{id:'p2',providerPaymentId:'fixture-payment'})),e=>e.code==='23505');});
  await check('required uniqueness: application user and job',async()=>{await transaction(r=>r.put('applications',{id:'a1',userId:'u1',jobId:'j1'}));await assert.rejects(transaction(r=>r.put('applications',{id:'a2',userId:'u1',jobId:'j1'})),e=>e.code==='23505');});
  await check('semantic model extraction/write/replay',async()=>{const {env}=await import('@huggingface/transformers');env.cacheDir='/tmp/skillonit-verification-model-cache';env.allowRemoteModels=true;const {indexSemantic}=await import('../src/job-engine/semantic.ts');const count=await indexSemantic(2);assert.equal(count,1);assert.equal(await indexSemantic(2),0);const vectors=await read(r=>r.find('jobVectors',{},10));assert.equal(vectors.length,1);assert.ok(vectors[0].vector.length>0);});
  await check('all 33 unique key definitions reject duplicate business keys',async()=>{
    const {postgresUniqueKeys}=await import('../src/lib/postgres-constraints.ts');
    const set=(row,path,value)=>{const parts=path.split('.');let at=row;for(const key of parts.slice(0,-1))at=at[key]??=( {} );at[parts.at(-1)]=value;};
    for(const [i,key]of postgresUniqueKeys.entries()){
      const fields=[...new Set(postgresUniqueKeys.filter(k=>k.collection===key.collection).flatMap(k=>k.fields))];
      const a={id:`constraint-${i}-a`},b={id:`constraint-${i}-b`};
      for(const field of fields){set(a,field,`a-${i}-${field}`);set(b,field,`b-${i}-${field}`);}
      for(const field of key.fields){set(a,field,`shared-${i}-${field}`);set(b,field,`shared-${i}-${field}`);}
      await transaction(r=>r.put(key.collection,a));
      await assert.rejects(transaction(r=>r.put(key.collection,b)),e=>e.code==='23505',`${key.collection}: ${key.fields.join(',')}`);
      await transaction(r=>r.remove(key.collection,a.id));
    }
    return {definitions:postgresUniqueKeys.length};
  });
  await check('partial string keys and missing/null uniqueness',async()=>{
    await transaction(r=>r.putMany('users',[{id:'partial-a',email:'a@example.test',googleId:7},{id:'partial-b',email:'b@example.test',googleId:7}]));
    await transaction(r=>r.put('users',{id:'missing-email'}));
    await assert.rejects(transaction(r=>r.put('users',{id:'null-email',email:null})),e=>e.code==='23505');
  });
  await check('separate processes preserve updates and one lease owner',async()=>{
    await transaction(r=>r.put('verification',{id:'process-counter',value:0}));
    const code=`import {transaction,closeStore} from './src/lib/store.ts'; try {
      const owner=process.env.VERIFY_TEST_OWNER;
      const acquired=await transaction(async r=>{const old=await r.get('verification','process-lease');await new Promise(resolve=>setTimeout(resolve,25));if(old&&old.until>Date.now())return false;await r.put('verification',{id:'process-lease',owner,until:Date.now()+60000});return true;});
      for(let i=0;i<10;i++)await transaction(async r=>{const row=await r.get('verification','process-counter');await new Promise(resolve=>setTimeout(resolve,5));await r.put('verification',{...row,value:row.value+1});});
      console.log(JSON.stringify({acquired}));
    } catch {process.exitCode=1;}finally{await closeStore();}`;
    const owners=await Promise.all([1,2,3].map(async owner=>{
      const child=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',code],{env:{...process.env,VERIFY_TEST_OWNER:String(owner)},stdio:['ignore','pipe','pipe'],windowsHide:true});
      let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.resume();
      const timeout=setTimeout(()=>child.kill(),30000);
      try{const [exit]=await once(child,'close');assert.equal(exit,0);return JSON.parse(output).acquired;}finally{clearTimeout(timeout);}
    }));
    assert.equal(owners.filter(Boolean).length,1);
    assert.equal((await read(r=>r.get('verification','process-counter'))).value,30);
  });
  await check('bounded expiry keeps future malformed and unrelated records',async()=>{
    const {prunePostgresExpiredDocuments}=await import('../src/lib/postgres-store.ts');
    await transaction(r=>r.putMany('sessions',[{id:'expired-1',expiresAtDate:'2020-01-01T00:00:00.000Z'},{id:'expired-2',expiresAtDate:'2020-01-02T00:00:00.000Z'},{id:'future',expiresAtDate:'2099-01-01T00:00:00.000Z'},{id:'invalid',expiresAtDate:'not-a-date'},{id:'relative',expiresAtDate:'yesterday'},{id:'missing'}]));
    await transaction(r=>r.put('verification',{id:'do-not-expire',expiresAtDate:'2020-01-01T00:00:00.000Z'}));
    assert.deepEqual(await prunePostgresExpiredDocuments(new Date('2026-01-01T00:00:00.000Z'),1),{sessions:1});
    assert.equal(await read(r=>r.count('sessions')),5);
    assert.deepEqual(await prunePostgresExpiredDocuments(new Date('2026-01-01T00:00:00.000Z'),10),{sessions:1});
    assert.equal(await read(r=>r.count('sessions')),4);
    assert.ok(await read(r=>r.get('verification','do-not-expire')));
  });
  await check('index migration refuses conflicts without altering records',async()=>{
    const {postgresUniqueDefinitions}=await import('../src/lib/postgres-store.ts');
    const key=postgresUniqueDefinitions().find(k=>k.collection==='payments');
    await pool.query(`DROP INDEX ${key.name}`);
    await transaction(r=>r.putMany('payments',[{id:'conflict-a',providerPaymentId:'conflict'},{id:'conflict-b',providerPaymentId:'conflict'}]));
    await assert.rejects(bootstrapIndexes(),/POSTGRES_UNIQUE_CONFLICTS/);
    assert.equal(await read(r=>r.count('payments',{providerPaymentId:'conflict'})),2);
    await transaction(async r=>{await r.remove('payments','conflict-a');await r.remove('payments','conflict-b');});
    await bootstrapIndexes();
  });
  if (process.env.VERIFY_EXTERNAL_MATCHING === 'true') await check('real matching embedding and search in isolated external index',async()=>{
    const {configuredMatchingProviders}=await import('../src/lib/matching-providers.ts');
    const index=`skillonit-verify-${Date.now()}-${randomUUID().slice(0,8)}`;
    const providers=configuredMatchingProviders({...process.env,MATCHING_OPENSEARCH_INDEX:index});
    assert.ok(providers.search);assert.ok(providers.embeddings);
    const endpoint=providers.config.endpoint.replace(/\/$/,'')+'/'+index;
    const headers={Authorization:providers.config.authorization};
    const request=(path,method)=>fetch(endpoint+path,{method,headers,signal:AbortSignal.timeout(15000)});
    const absent=await request('','HEAD');assert.equal(absent.status,404,'refuse to modify an existing index');
    try{
      await providers.search.ensureIndex();
      const opts={version:index,force:true};
      const first=await read(r=>syncMatchingIndex(r,providers.search,providers.embeddings,defaultRankingPolicy(),opts));assert.equal(first.indexed,1);
      const refreshed=await request('/_refresh','POST');assert.ok(refreshed.ok);
      const hits=await providers.search.retrieve(['clinical','nurse'],undefined,defaultRankingPolicy(),Date.now());assert.ok(hits.length>=1);
      const replay=await read(r=>syncMatchingIndex(r,providers.search,providers.embeddings,defaultRankingPolicy(),{version:index}));assert.equal(replay.skipped,1);
      const job=(await read(r=>r.find('jobs',{},10)))[0];await providers.search.remove(job.id);
      const missing=await request('/_doc/'+encodeURIComponent(job.id),'GET');assert.equal(missing.status,404);
      return {indexed:1,replaySkipped:1,removed:1};
    } finally {
      const removed=await request('','DELETE');if(!removed.ok&&removed.status!==404)throw Error('ISOLATED_SEARCH_INDEX_CLEANUP_FAILED');
    }
  });
  console.log(JSON.stringify({summary:results}));
  if (results.some(result => result.result === 'FAIL')) process.exitCode = 1;
} finally {await closeStore();await pool.end();}
