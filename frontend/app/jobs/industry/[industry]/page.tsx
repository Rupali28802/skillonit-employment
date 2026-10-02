import type { Metadata } from 'next'; import { SeoLanding } from '@/components/seo-landing'; import { getSeoPage,seoMetadata } from '@/lib/seo';
const path=async(p:Promise<{industry:string}>)=>`/jobs/industry/${(await p).industry}`;
export async function generateMetadata({params}:{params:Promise<{industry:string}>}):Promise<Metadata>{const result=await getSeoPage(await path(params));return result?seoMetadata(result.page):{title:'Jobs unavailable',robots:{index:false,follow:true}};}
export default async function Page({params}:{params:Promise<{industry:string}>}){return <SeoLanding path={await path(params)}/>;}
