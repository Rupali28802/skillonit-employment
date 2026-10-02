import type { MetadataRoute } from 'next';
import { getSeoRegistry,siteOrigin } from '@/lib/seo';
export const dynamic='force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!process.env.APP_URL || process.env.DEMO_MODE === 'true') return [];
  const origin=siteOrigin(), fixed=['','/about','/trust','/contact','/pricing','/privacy','/terms'].map(path=>({url:origin+path,changeFrequency:'weekly' as const,priority:path===''?1:0.6}));
  try { const registry=await getSeoRegistry(); const pages=registry.pages.filter(page=>page.indexable&&page.sitemapEligible).map(page=>({url:origin+page.canonicalPath,lastModified:new Date(page.lastVerifiedAt),changeFrequency:'daily' as const,priority:0.7})); const jobs=registry.eligibleJobIds.map(id=>({url:`${origin}/jobs/${encodeURIComponent(id)}`,lastModified:new Date(registry.generatedAt),changeFrequency:'daily' as const,priority:0.8})); return [...fixed,...pages,...jobs].slice(0,49_900); } catch { return fixed; }
}
