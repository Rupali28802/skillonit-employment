import type { Metadata } from 'next'; import { SeoLanding } from '@/components/seo-landing'; import { getSeoPage,seoMetadata } from '@/lib/seo';
const path=async(p:Promise<{skill:string}>)=>`/jobs/skills/${(await p).skill}`;
export async function generateMetadata({params}:{params:Promise<{skill:string}>}):Promise<Metadata>{const result=await getSeoPage(await path(params));return result?seoMetadata(result.page):{title:'Jobs unavailable',robots:{index:false,follow:true}};}
export default async function Page({params}:{params:Promise<{skill:string}>}){return <SeoLanding path={await path(params)}/>;}
