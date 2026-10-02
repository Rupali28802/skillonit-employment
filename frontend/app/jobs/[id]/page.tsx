import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getJob } from '@/lib/api';
import { JobActions } from '@/components/job-actions';
import type { Metadata } from 'next';
import { jsonLd,siteOrigin } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}):Promise<Metadata> {
  const { id } = await params;
  const j = await getJob(id);
  if(!j||j.status!=='published')return {title:'Opportunity unavailable',robots:{index:false,follow:true}};
  const canonical=`/jobs/${encodeURIComponent(j.id)}`,description=`${j.title} in ${j.city}, ${j.country}. Review the role, requirements and application options on SkillOnIT Employment.`;
  return {title:j.title,description,alternates:{canonical},robots:{index:j.seoEligible,follow:true},openGraph:{type:'article',title:j.title,description,url:canonical,siteName:'SkillOnIT Employment'}};
}
export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job || job.status !== 'published') notFound();
  const j = job;
  const employmentType:Record<string,string>={'full-time':'FULL_TIME','part-time':'PART_TIME','contract':'CONTRACTOR','internship':'INTERN','temporary':'TEMPORARY'};
  const jobSchema=j.seoEligible?{'@context':'https://schema.org','@type':'JobPosting',title:j.title,description:j.description,datePosted:j.sourcePostedAt,validThrough:j.expiresAt,employmentType:employmentType[j.type.toLowerCase().replace(/[ _]+/g,'-')],hiringOrganization:{'@type':'Organization',name:j.company},occupationalCategory:j.category,skills:j.skills.join(', '),url:`${siteOrigin()}/jobs/${encodeURIComponent(j.id)}`,...(j.mode==='Remote'?{jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{'@type':'Country',name:j.country}}:{jobLocation:{'@type':'Place',address:{'@type':'PostalAddress',addressLocality:j.city,addressRegion:j.state,addressCountry:j.country}}}),...(j.salaryDisclosed&&j.salaryMin>=0&&j.salaryMax>=j.salaryMin?{baseSalary:{'@type':'MonetaryAmount',currency:j.currency,value:{'@type':'QuantitativeValue',minValue:j.salaryMin,maxValue:j.salaryMax,unitText:(j.normalizedFacts?.salary.period||'YEAR').toUpperCase()}}}:{})}:null;
  return (
    <div className="page-wrap">
      {jobSchema&&<script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(jobSchema)}/>}
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Home',item:siteOrigin()+'/'},{'@type':'ListItem',position:2,name:'Jobs',item:siteOrigin()+'/'},{'@type':'ListItem',position:3,name:j.title,item:`${siteOrigin()}/jobs/${encodeURIComponent(j.id)}`}]})}/>
      <Link href="/">← Back to opportunities</Link>
      <div className="detail-grid" style={{ marginTop: 25 }}>
        <div>
          <div className="panel">
            <span className="pill">{j.category}</span>
            <h1 style={{ marginTop: 20 }}>{j.title}</h1>
            <p>{j.company}</p>
            <div className="job-facts">
              <span>
                {j.city}, {j.country}
              </span>
              <span>{j.mode}</span>
              <span>{j.type}</span>
              <span>
                {j.experienceDisclosed === false ? 'Experience not specified' : `${j.experienceMin}–${j.experienceMax} years`}
              </span>
            </div>
            {j.sample && (
              <p className="notice" style={{ marginTop: 20 }}>
                Demonstration vacancy · This is not a real hiring opportunity.
              </p>
            )}
          </div>
          <div className="panel">
            <h2>About the role</h2>
            <p>{j.description}</p>
            <h2>What you’ll bring</h2>
            <p>{j.requirements}</p>
            <div className="skills">
              {j.skills.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          </div>
        </div>
        <aside>
          <div className="panel">
            <h2>Your next step</h2>
            <p>
              {j.method === 'direct'
                ? 'Apply through SkillonIT'
                 : j.method === 'external'
                  ? 'Open the source application'
                  : 'Apply by authorized email'}
            </p>
            {job.acceptingApplications ? (
              <JobActions jobId={j.id} sample={j.sample} />
            ) : (
              <p className="notice">
                This vacancy is no longer accepting applications.
              </p>
            )}
            <hr
              style={{
                border: 0,
                borderTop: '1px solid #dfe7e1',
                margin: '24px 0',
              }}
            />
            <h3>Opportunity details</h3>
            <p className="small">
              {j.salaryDisclosed === false ? (j.salaryText || 'Salary not specified') : <>Annual salary:{' '}
              {new Intl.NumberFormat('en', {
                style: 'currency',
                currency: j.currency,
              }).format(j.salaryMin)}{' '}
              –{' '}
              {new Intl.NumberFormat('en', {
                style: 'currency',
                currency: j.currency,
              }).format(j.salaryMax)}</>}
            </p>
            <p className="small">
              Source: {j.sourceLink ? <a href={j.sourceLink} target="_blank" rel="noopener noreferrer">{j.source} ↗</a> : j.source}
              <br />
              Verification: {j.trust}
              <br />
              Discovered: {new Date(j.discoveredAt).toLocaleDateString('en-IN')}
              <br />
              Expires: {new Date(j.expiresAt).toLocaleDateString('en-IN')}
            </p>
            {!j.identityVisible && (
              <Link href="/pricing">Compare identity access by plan →</Link>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
