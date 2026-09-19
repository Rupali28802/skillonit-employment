import { Discovery } from '@/components/discovery';
import { api, currentUser } from '@/lib/api';
import type { PublicJob } from '@/lib/domain';
export const dynamic = 'force-dynamic';
type SearchValue = string | string[] | undefined;
function first(value: SearchValue) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const [result, user, params] = await Promise.all([
    api<{ jobs: PublicJob[] }>('jobs'),
    currentUser(),
    searchParams,
  ]);
  return (
    <Discovery
      initialJobs={result.jobs}
      user={user}
      initialSearch={{
        query: first(params.q),
        country: first(params.country),
        mode: first(params.mode),
      }}
    />
  );
}
