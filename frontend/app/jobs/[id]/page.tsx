import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getJob } from '@/lib/api';
import { JobActions } from '@/components/job-actions';
export const dynamic = 'force-dynamic';

function authorizedExternalUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
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
  const applicationUrl = authorizedExternalUrl(j.publicApplicationLink)
    || authorizedExternalUrl(j.sourceLink);
  const location = [j.city, j.state, j.country]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(', ') || 'Location not specified';
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
              <span>{location}</span>
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
            <h2>Company information</h2>
            <p><strong>{j.company}</strong></p>
            <p className="small">
              This opportunity was discovered through {j.source}. Company details shown here come from the original listing; SkillonIT does not invent missing employer information.
            </p>
            <div className="job-facts">
              <span>{location}</span>
              <span>{j.trust === 'verified' ? 'Verified listing' : j.trust === 'flagged' ? 'Needs review' : 'Verification pending'}</span>
            </div>
          </div>
          <div className="panel">
            <h2>About the role</h2>
            <p>{j.description || 'The original source did not provide a job description.'}</p>
            <h2>Requirements</h2>
            <p>{j.requirements || 'The original source did not provide separate requirements.'}</p>
            {j.skills.length > 0 ? <div className="skills">
              {j.skills.map((s) => <span key={s}>{s}</span>)}
            </div> : <p className="small">Skills were not specified separately in the original listing.</p>}
          </div>
        </div>
        <aside>
          <div className="panel">
            <h2>Your next step</h2>
            <p>
              Review the information on this page, then continue to the real employer or authorized application source. SkillonIT will not claim that an external application was submitted.
            </p>
            <hr
              style={{
                border: 0,
                borderTop: '1px solid #dfe7e1',
                margin: '24px 0',
              }}
            />
            <h3>Opportunity details</h3>
            <p className="small">
              Job type: {j.type || 'Not specified'}
              <br />
              Work mode: {j.mode || 'Not specified'}
              <br />
              Experience: {j.experienceDisclosed === false ? 'Not specified' : `${j.experienceMin}–${j.experienceMax} years`}
              <br />
              Compensation: {j.salaryDisclosed === false ? (j.salaryText || 'Not specified') : <>
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
              Original source: {authorizedExternalUrl(j.sourceLink) ? <a href={authorizedExternalUrl(j.sourceLink)!} target="_blank" rel="noopener noreferrer">{j.source} ↗</a> : j.source}
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
            <hr
              style={{
                border: 0,
                borderTop: '1px solid #dfe7e1',
                margin: '24px 0',
              }}
            />
            {j.sample ? (
              <p className="notice">
                Applications are disabled because this is a demonstration vacancy.
              </p>
            ) : job.acceptingApplications && applicationUrl ? (
              <a className="primary full" href={applicationUrl} target="_blank" rel="noopener noreferrer" aria-label={`Proceed to apply for ${j.title} on ${j.source}`}>Proceed to Apply ↗</a>
            ) : job.acceptingApplications ? (
              <JobActions jobId={j.id} buttonLabel="Proceed to Apply" />
            ) : (
              <p className="notice">
                This vacancy is no longer accepting applications.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
