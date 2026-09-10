import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import he from 'he';
import type { Job } from '../lib/domain.js';
import type { Candidate } from './adapters.js';
import type { FeedSource } from './sources.js';

export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function plain(input: string, limit = 30000) {
  return he.decode(input.slice(0, 200000)).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}
export function canonicalUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || isIP(u.hostname.replace(/^\[|\]$/g, '')) || !u.hostname.includes('.') || /(^|\.)(localhost|local|internal|invalid|test)$/.test(u.hostname)) throw Error('INVALID_JOB_URL');
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|referrer$|source$|gh_src$|lever-source$)/i.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  return u.href;
}
const categories: [string, RegExp][] = [
  ['Healthcare', /\b(nurs|health|medical|physician|doctor|clinical|pflege|arzt|therap)/i],
  ['Education', /\b(teach|education|professor|teacher|lehrer|trainer)/i],
  ['Legal', /\b(legal|lawyer|counsel|compliance|rechts)/i],
  ['Finance', /\b(financ|accountant|accounting|bank|steuer|buchhalt|audit)/i],
  ['Design', /\b(design|ux|ui |graphic|creative)/i],
  ['Marketing', /\b(marketing|seo|content|social media|communications)/i],
  ['Sales', /\b(sales|business development|account executive|vertrieb|verkauf)/i],
  ['Hospitality', /\b(hotel|hospitality|restaurant|chef|tourism|cook|gastronom)/i],
  ['Logistics', /\b(logistic|warehouse|supply chain|driver|delivery|lager|fahrer)/i],
  ['Technology', /\b(software|developer|devops|data|security|cloud|it\b|informat|entwickl|service desk|full.?stack)/i],
  ['Engineering', /\b(engineer|engineering|mechanic|electrical|bau|ingenieur|technician)/i],
  ['Operations', /\b(operation|support|human resources|recruit|administrat|customer|personal|office)/i],
];
export function categoryFor(c: Candidate) {
  const input = [c.category, c.title, ...(c.tags || [])].join(' ');
  return categories.find(([, pattern]) => pattern.test(input))?.[0] || 'Other';
}
const countryAliases: Record<string, string> = { USA: 'United States', US: 'United States', GBR: 'United Kingdom', GB: 'United Kingdom', UK: 'United Kingdom', DEU: 'Germany', DE: 'Germany', IND: 'India', IN: 'India', CAN: 'Canada', CA: 'Canada', AUS: 'Australia', AU: 'Australia' };
function countryName(raw: string | undefined, location: string) {
  if (raw) {
    if (countryAliases[raw.toUpperCase()]) return countryAliases[raw.toUpperCase()];
    if (/^[A-Z]{2}$/i.test(raw)) return new Intl.DisplayNames(['en'], { type: 'region' }).of(raw.toUpperCase()) || raw;
    return plain(raw, 100);
  }
  if (/^(worldwide|anywhere|global)$/i.test(location)) return 'Worldwide';
  const explicit = [...new Set(Object.values(countryAliases))].find(c => new RegExp(`(?:^|[,; ]+)${c}(?:$|[,;])`, 'i').test(location));
  return explicit || 'Not specified';
}
export function normalize(c: Candidate, source: FeedSource, now = Date.now()): Job {
  const title = plain(c.title, 240), company = plain(c.company, 150), description = plain(c.description);
  if (!c.externalId || c.externalId.length > 2000 || !title || !company || description.length < 30) throw Error('MISSING_JOB_FACTS');
  const url = canonicalUrl(c.url);
  if (source.type === 'remotive' && new URL(url).hostname !== 'remotive.com') throw Error('INVALID_ATTRIBUTION');
  if (source.type.startsWith('arbeitnow') && new URL(url).hostname !== (source.type === 'arbeitnow' ? 'www.arbeitnow.com' : 'www.arbeitnow.co.uk')) throw Error('INVALID_ATTRIBUTION');
  const posted = c.postedAt ? Date.parse(c.postedAt) : undefined;
  if (posted !== undefined && (!Number.isFinite(posted) || posted > now + 300000 || posted < now - 90 * 86400000)) throw Error('STALE_OR_INVALID_DATE');
  const suspicious = /\b(pay|send|transfer)\b.{0,50}\b(fee|deposit|password|otp)\b|registration fee/i.test(description);
  const stamp = new Date(now).toISOString();
  return {
    id: 'feed-' + hash(url), title, company, domain: '', country: countryName(c.country, c.location), state: '',
    city: plain(c.location, 240) || 'Not specified', category: categoryFor(c), skills: (c.tags || []).map(t => plain(t, 80)).filter(Boolean).slice(0, 30),
    mode: c.mode || 'Not specified', type: plain(c.employmentType || '', 120) || 'Not specified',
    salaryMin: 0, salaryMax: 0, currency: 'USD', salaryDisclosed: false, salaryText: plain(c.salaryText || '', 300),
    experienceMin: 0, experienceMax: 0, experienceDisclosed: false,
    description, requirements: 'See the original listing for the complete requirements.', method: 'external', url,
    status: source.publish && !suspicious ? 'published' : 'review', trust: suspicious ? 'flagged' : 'pending',
    employerId: '', source: source.name, discoveredAt: stamp,
    // Refresh only this availability deadline; never reset the original posting/first-discovery dates.
    expiresAt: new Date(Math.min(now + 72 * 3600000, (posted ?? now) + 90 * 86400000)).toISOString(),
    ...(posted !== undefined ? { sourcePostedAt: new Date(posted).toISOString() } : {}),
    feed: { sourceId: source.id, externalId: c.externalId, publicListing: source.publicListing, attributionUrl: url, lastSeenAt: stamp },
  };
}
export const duplicateKey = (j: Job) => hash([j.title, j.company, j.city, j.country, j.description].join('|').toLowerCase().replace(/\s+/g, ' ').trim());
