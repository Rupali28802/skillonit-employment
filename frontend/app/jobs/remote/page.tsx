import type { Metadata } from 'next'; import { SeoLanding } from '@/components/seo-landing'; import { getSeoPage,seoMetadata } from '@/lib/seo'; const path='/jobs/remote';
export async function generateMetadata():Promise<Metadata>{const result=await getSeoPage(path);return result?seoMetadata(result.page):{title:'Remote jobs unavailable',robots:{index:false,follow:true}};}
export default function Page(){return <SeoLanding path={path}/>;}
