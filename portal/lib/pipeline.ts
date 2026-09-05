import { createHash } from 'node:crypto';
import type { Job } from './domain';
export type SourcePolicy = {
  id: string;
  type: 'greenhouse';
  board: string;
  enabled: boolean;
  approved: boolean;
  requestsPerMinute: number;
};
export interface SourceAdapter {
  discover(policy: SourcePolicy): Promise<Partial<Job>[]>;
}
export function fingerprint(
  job: Pick<Job, 'title' | 'company' | 'city' | 'country'>,
) {
  return createHash('sha256')
    .update(
      [job.title, job.company, job.city, job.country]
        .map((v) => v.trim().toLowerCase().replace(/\s+/g, ' '))
        .join('|'),
    )
    .digest('hex');
}
export function classifyRisk(
  job: Pick<Job, 'description' | 'email' | 'domain'>,
) {
  const reasons: string[] = [];
  if (
    /pay.{0,20}(fee|deposit)|registration fee|send.{0,20}(password|otp)/i.test(
      job.description,
    )
  )
    reasons.push('Suspicious payment or credential request');
  if (
    job.email &&
    job.email.split('@')[1]?.toLowerCase() !== job.domain.toLowerCase()
  )
    reasons.push('Recruitment email does not match employer domain');
  return {
    level: reasons.length ? 'high' : 'review',
    reasons,
    automationAllowed: false,
  };
}
export class GreenhouseAdapter implements SourceAdapter {
  async discover(policy: SourcePolicy) {
    if (!policy.enabled || !policy.approved)
      throw Error('Source is not approved and enabled.');
    if (!/^[a-z0-9_-]{1,80}$/i.test(policy.board))
      throw Error('Invalid board identifier.');
    const response = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(policy.board)}/jobs?content=true`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw Error('Source returned HTTP ' + response.status);
    const data = await response.json();
    return (data.jobs || [])
      .slice(0, 1000)
      .map(
        (j: {
          id: number;
          title: string;
          absolute_url: string;
          content: string;
          location: { name: string };
        }) => ({
          id: `greenhouse-${policy.board}-${j.id}`,
          title: j.title,
          url: j.absolute_url,
          description: j.content.replace(/<[^>]*>/g, ' ').slice(0, 15000),
          city: j.location?.name || '',
          method: 'external' as const,
          source: policy.id,
          status: 'review' as const,
          trust: 'pending' as const,
        }),
      );
  }
}
export class MockSourceAdapter implements SourceAdapter {
  constructor(private jobs: Partial<Job>[]) {}
  async discover(policy: SourcePolicy) {
    if (!policy.approved || !policy.enabled) throw Error('Source not approved');
    return this.jobs;
  }
}
export function retryDelay(attempt: number) {
  return Math.min(3600000, 1000 * 2 ** Math.min(attempt, 12));
}
export function renderTemplate(
  template: string,
  facts: { name: string; job_title: string },
) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, key: string) => {
    if (!(key in facts)) throw Error('Unconfirmed template variable: ' + key);
    return facts[key as keyof typeof facts];
  });
}
