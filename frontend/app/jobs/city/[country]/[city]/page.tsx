import type { Metadata } from 'next'; import { SeoLanding } from '@/components/seo-landing'; import { getSeoPage,seoMetadata } from '@/lib/seo';
const path=async(p:Promise<{country:string;city:string}>)=>{const x=await p;return `/jobs/city/${x.country}/${x.city}`};
export async function generateMetadata({params}:{params:Promise<{country:string;city:string}>}):Promise<Metadata>{const result=await getSeoPage(await path(params));return result?seoMetadata(result.page):{title:'Jobs unavailable',robots:{index:false,follow:true}};}
export default async function Page({params}:{params:Promise<{country:string;city:string}>}){return <SeoLanding path={await path(params)}/>;}
