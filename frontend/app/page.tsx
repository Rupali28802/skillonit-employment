import { Discovery } from '@/components/discovery';
import { api, currentUser } from '@/lib/api';
import type { PublicJob } from '@/lib/domain';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const result = await api<{ jobs: PublicJob[] }>('jobs?sort=discovered&limit=24');
  return <Discovery initialJobs={result.jobs} user={await currentUser()} />;
}
