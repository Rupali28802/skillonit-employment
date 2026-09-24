import { Discovery } from '@/components/discovery';
import { api, currentUser } from '@/lib/api';
import type { PublicJob } from '@/lib/domain';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const [jobsResult, userResult] = await Promise.allSettled([
    api<{ jobs: PublicJob[] }>('jobs?sort=discovered&limit=24'),
    currentUser(),
  ]);
  const initialJobs = jobsResult.status === 'fulfilled' ? jobsResult.value.jobs : [];
  const user = userResult.status === 'fulfilled' ? userResult.value : null;
  return <Discovery initialJobs={initialJobs} user={user} />;
}
