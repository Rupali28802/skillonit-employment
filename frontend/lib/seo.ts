import type { Metadata } from 'next';
import { api, BackendError } from './api';
import type { PublicJob } from './domain';

export type SeoRegistryPage = { pageType:string; canonicalPath:string; country?:string; city?:string; skill?:string; industry?:string; jobType?:string; workArrangement?:string; intent:string; title:string; description:string; h1:string; topics:string[]; indexable:boolean; sitemapEligible:boolean; jobCount:number; lastVerifiedAt:string; exclusionReason?:string };
export type SeoRegistry = { generatedAt:string; referenceCountries:number; countriesWithJobs:number; approvedCountries:number; pages:SeoRegistryPage[]; eligibleJobIds:string[]; noindexJobs:number; duplicatesPrevented:number; totalJobs:number; scannedJobs:number; truncated:boolean };
export type SeoPageResult = { page:SeoRegistryPage; jobs:PublicJob[] };

export const siteOrigin = () => {
  try { const url=new URL(process.env.APP_URL || 'https://employment.skillonit.com'); return url.origin; }
  catch { return 'https://employment.skillonit.com'; }
};
export async function getSeoPage(path:string) { try{return await api<SeoPageResult>(`seo/page?path=${encodeURIComponent(path)}`);}catch(error){if(error instanceof BackendError&&error.status===404)return null;throw error;} }
export async function getSeoRegistry() { return api<SeoRegistry>('seo/registry'); }
export function seoMetadata(page:SeoRegistryPage):Metadata { const url=new URL(page.canonicalPath,siteOrigin()).href; return { title:{absolute:page.title},description:page.description,alternates:{canonical:url},robots:{index:page.indexable,follow:true},openGraph:{type:'website',title:page.title,description:page.description,url,siteName:'SkillOnIT Employment'} }; }
export const jsonLd = (value:unknown) => ({ __html: JSON.stringify(value).replace(/</g,'\\u003c') });
