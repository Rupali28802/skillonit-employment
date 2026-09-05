import { Discovery } from '@/components/discovery';
import { api } from '@/lib/api';
import type { PublicJob } from '@/lib/domain';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const result = await api<{ jobs: PublicJob[] }>('jobs');
  return <Discovery initialJobs={result.jobs} />;
}
