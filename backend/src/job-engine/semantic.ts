import { createHash } from 'node:crypto';
import { pipeline } from '@huggingface/transformers';
import { read, transaction } from '../lib/store.js';
import type { Job } from '../lib/domain.js';

const model = 'Xenova/all-MiniLM-L6-v2';
let extractor: Promise<any> | undefined;
export async function embed(text: string): Promise<number[]> {
  extractor ||= pipeline('feature-extraction', model, { dtype: 'q8' }).catch((error: unknown) => { extractor = undefined; throw error; });
  const result = await (await extractor)(text.slice(0, 4000), { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}
type Vector = { id: string; model: string; fingerprint: string; vector: number[] };
const content = (j: Job) => [j.title, j.category, ...j.skills, j.description].join('\n').slice(0, 4000);
// Bounded maintenance pass. Full rebuild is an explicit CLI operation.
export async function indexSemantic(limit = 50) {
  let cursor = '', indexed = 0;
  for (;;) {
    const jobs = await read(r => r.scan<Job>('jobs', {status:'published', 'feed.publicListing':true, expiresAt:{$gt:new Date().toISOString()}}, cursor, 100));
    if (!jobs.length) break;
    const existing = new Map((await read(r=>r.find<Vector>('jobVectors',{id:{$in:jobs.map(j=>j.id)}},100))).map(v=>[v.id,v]));
    const writes: Vector[] = [];
    for (const job of jobs) {
      const text = content(job), fingerprint = createHash('sha256').update(text).digest('hex');
      const old = existing.get(job.id);
      if (old?.model === model && old.fingerprint === fingerprint) continue;
      const vector = await embed(text);
      writes.push({id:job.id,model,fingerprint,vector});
      if (++indexed >= limit) { await transaction(r=>r.putMany('jobVectors',writes)); return indexed; }
    }
    if (writes.length) await transaction(r=>r.putMany('jobVectors',writes));
    cursor = jobs[jobs.length-1].id;
  }
  return indexed;
}
export async function semanticMatches(query: string, encoder = embed) {
  const q = await encoder(query), matches: {id:string;score:number}[] = [];
  let cursor = '';
  for (;;) {
    const rows = await read(r => r.scan<Vector>('jobVectors',{model},cursor,500));
    if (!rows.length) break;
    for (const row of rows) {
      if (row.vector.length !== q.length) continue;
      const score = q.reduce((sum,v,i)=>sum+v*row.vector[i],0);
      if (Number.isFinite(score) && score >= 0.4) matches.push({id:row.id,score});
    }
    cursor=rows[rows.length-1].id;
  }
  return matches.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
}
