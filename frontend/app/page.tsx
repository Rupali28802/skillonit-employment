import { Discovery } from '@/components/discovery';
import { api, currentUser, getJob } from '@/lib/api';
import type { PublicJob } from '@/lib/domain';
import type { Metadata } from 'next';
export const metadata:Metadata={alternates:{canonical:'/'},robots:{index:true,follow:true}};
export const dynamic = 'force-dynamic';
export default async function Home() {
  const featuredId = process.env.FEATURED_PUBLIC_JOB_ID?.trim();
  const [jobsResult, userResult, featuredResult] = await Promise.allSettled([
    api<{ jobs: PublicJob[] }>('jobs?sort=discovered&limit=24'),
    currentUser(),
    featuredId ? getJob(featuredId) : null,
  ]);
  const initialJobs = jobsResult.status === 'fulfilled' ? jobsResult.value.jobs : [];
  const user = userResult.status === 'fulfilled' ? userResult.value : null;
  const job = featuredResult.status === 'fulfilled' ? featuredResult.value : null;
  const featuredJob = job?.status === 'published' && job.trust === 'verified' && job.acceptingApplications && !job.sample
    ? { id: job.id, title: job.title }
    : undefined;
  return <Discovery initialJobs={initialJobs} user={user} featuredJob={featuredJob} />;
}
