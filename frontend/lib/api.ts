import { cookies } from 'next/headers';
import { cache } from 'react';
import type { Plan, PublicJob, User } from './domain';

export class BackendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Presentation data fetches only. All authorization, persistence and business rules
// live in Express. Browser mutations use the same-origin /api rewrite.
export async function api<T>(path: string): Promise<T> {
  const response = await fetch(
    `${process.env.BACKEND_URL || 'http://127.0.0.1:4100'}/api/v1/${path}`,
    {
      headers: { Cookie: (await cookies()).toString() },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    },
  );
  // During a proxy/upstream failure an HTML error page must never leak its
  // JSON parser error into a rendered route. Browser discovery already uses
  // the same defensive rule; keep server-rendered pages equally resilient.
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json'))
    throw new BackendError(response.status || 502, 'Backend returned an unexpected response. Please retry.');
  let result: { data?: T; error?: { message?: string } };
  try {
    result = await response.json() as { data?: T; error?: { message?: string } };
  } catch {
    throw new BackendError(response.status || 502, 'Backend returned an invalid response. Please retry.');
  }
  if (!response.ok)
    throw new BackendError(
      response.status,
      result.error?.message || 'Backend unavailable',
    );
  return result.data as T;
}
const session = cache(() =>
  api<{ user: User | null; demo: boolean }>('session'),
);
export const currentUser = async () => (await session()).user;
export const demoMode = async () => (await session()).demo;
export const configuredPlans = cache(
  async () => (await api<{ plans: Plan[] }>('plans')).plans,
);
export const getJob = cache(async (id: string) => {
  try {
    return await api<PublicJob & { acceptingApplications: boolean; seoEligible: boolean }>(
      'jobs/' + encodeURIComponent(id),
    );
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) return null;
    throw error;
  }
});
