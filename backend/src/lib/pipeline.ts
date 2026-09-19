import { createHash } from 'node:crypto';
import type { Job } from './domain.js';
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
