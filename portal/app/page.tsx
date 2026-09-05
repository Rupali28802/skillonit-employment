import { Discovery } from '@/components/discovery';
import { searchJobs } from '@/lib/search';
import { currentUser } from '@/lib/security';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const result = await searchJobs(new URLSearchParams(), await currentUser());
  return <Discovery initialJobs={result.jobs} />;
}
