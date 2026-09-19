import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getJob } from '@/lib/api';
import { JobActions } from '@/components/job-actions';
export const dynamic = 'force-dynamic';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const j = await getJob(id);
  return {
    title: j?.status === 'published' ? j.title : 'Opportunity unavailable',
    robots: { index: false, follow: true },
  };
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
  return (
    <div className="page-wrap">
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
                  ? 'Continue on the employer website'
                  : 'Apply by authorized email'}
            </p>
            {job.acceptingApplications && j.sourceLink ? (
              <a className="primary full" href={j.publicApplicationLink || j.sourceLink} target="_blank" rel="noopener noreferrer">View original job from {j.source} ↗</a>
            ) : job.acceptingApplications ? (
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
