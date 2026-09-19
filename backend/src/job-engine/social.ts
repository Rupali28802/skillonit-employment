import { z } from 'zod';
import { read, transaction } from '../lib/store.js';
import { canonicalUrl, hash, plain } from './normalize.js';
import { assessRisk } from './risk.js';

export const socialSourceSchema = z.object({id:z.string().regex(/^[a-z0-9_-]{1,80}$/),name:z.string().min(1).max(100),
  hostname:z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),permissionEvidence:z.string().min(30).max(2000),
  approved:z.boolean(), expiresAt:z.string().datetime()});
export const socialPostSchema = z.object({sourceId:z.string().max(80),externalId:z.string().min(1).max(200),
  url:z.string().url(),text:z.string().min(1).max(20000),postedAt:z.string().datetime(),deleted:z.boolean().default(false)});
export async function ingestSocial(input: unknown, actorId: string) {
  const post=socialPostSchema.parse(input);
  const source=socialSourceSchema.parse(await read(r=>r.get('socialSources',post.sourceId)));
  if (!source.approved || Date.parse(source.expiresAt)<=Date.now()) throw Error('SOCIAL_PERMISSION_REQUIRED');
  const url=canonicalUrl(post.url);
  if(new URL(url).hostname!==source.hostname) throw Error('SOCIAL_SOURCE_HOST_MISMATCH');
  if(Date.parse(post.postedAt)>Date.now()+300000) throw Error('FUTURE_POST');
  const text=plain(post.text,20000), risk=assessRisk(text,url);
  const id=hash(source.id+':'+post.externalId);
  // Preserve content and provenance; do not turn arbitrary prose into confirmed job facts.
  const state=post.deleted?'removed':Date.parse(post.postedAt)<Date.now()-30*86400000?'stale':risk.reasons.length?'flagged':'review';
  await transaction(async r=>{
    const previous=await r.get<{firstSeenAt:string}>('socialPosts',id);
    await r.put('socialPosts',{id,...post,url,text,source:source.name,risk,state,contentType:'hiring_post',
      firstSeenAt:previous?.firstSeenAt||new Date().toISOString(),updatedAt:new Date().toISOString(),actorId});
  });
  return {id,state};
}
