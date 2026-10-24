import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getSeoPage, getSeoRegistry, jsonLd, siteOrigin } from '@/lib/seo';

export async function SeoLanding({path}:{path:string}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const result=await getSeoPage(path); if(!result)notFound();
  const {page,jobs}=result, origin=siteOrigin();
  const registry=await getSeoRegistry().catch(()=>null);
  const related=(registry?.pages??[]).filter(item=>item.canonicalPath!==path&&item.indexable&&(item.country===page.country||item.pageType===page.pageType)).slice(0,8);
  const crumbs=[{name:'Home',item:origin+'/'},{name:'Jobs',item:origin+'/'},{name:page.h1,item:origin+page.canonicalPath}];
  return <div className="seo-page">
    <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={jsonLd({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:crumbs.map((item,index)=>({'@type':'ListItem',position:index+1,...item}))})}/>
    <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={jsonLd({'@context':'https://schema.org','@type':'ItemList',name:page.h1,numberOfItems:jobs.length,itemListElement:jobs.map((job,index)=>({'@type':'ListItem',position:index+1,url:`${origin}/jobs/${encodeURIComponent(job.id)}`,name:job.title}))})}/>
    <nav className="seo-breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>›</span><Link href="/">Jobs</Link><span>›</span><span aria-current="page">{page.h1}</span></nav>
    <header className="seo-hero"><p className="eyebrow">{page.intent.toUpperCase()}</p><h1>{page.h1}</h1><p>{page.description}</p><small>Inventory verified {new Date(page.lastVerifiedAt).toLocaleDateString('en-IN')}</small></header>
    <section aria-labelledby="current-jobs"><div className="seo-section-head"><div><h2 id="current-jobs">Current jobs</h2><p>{page.jobCount.toLocaleString('en-IN')} current {page.jobCount===1?'opportunity':'opportunities'} matched this page.</p></div></div>
      <div className="seo-job-grid">{jobs.map(job=><article className="seo-job-card" key={job.id}><span>{job.category}</span><h3><Link href={`/jobs/${encodeURIComponent(job.id)}`}>{job.title}</Link></h3><p>{job.city}, {job.country}</p><div><small>{job.mode}</small><small>{job.type}</small></div><Link href={`/jobs/${encodeURIComponent(job.id)}`}>View opportunity →</Link></article>)}</div>
    </section>
    {related.length>0&&<section aria-labelledby="related-pages"><h2 id="related-pages">Related job discovery</h2><nav className="seo-related" aria-label="Related job pages">{related.map(item=><Link href={item.canonicalPath} key={item.canonicalPath}>{item.h1}</Link>)}</nav></section>}
  </div>;
}
