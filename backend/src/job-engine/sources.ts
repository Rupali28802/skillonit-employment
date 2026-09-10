import { z } from 'zod';

export const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  type: z.enum(['arbeitnow', 'arbeitnow-uk', 'remotive', 'jobicy', 'adzuna', 'usajobs', 'ashby', 'greenhouse', 'lever']),
  countryCode: z.string().regex(/^[a-z]{2}$/).optional(),
  keywords: z.string().trim().max(100).optional(),
  name: z.string().trim().min(1).max(100),
  board: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  company: z.string().trim().min(1).max(150).optional(),
  enabled: z.boolean(), approved: z.boolean(),
  policyEvidence: z.string().min(20).max(2000),
  publicListing: z.boolean().default(false),
  publish: z.boolean().default(false),
  intervalMinutes: z.number().int().min(30).max(10080).default(60),
  maxPages: z.number().int().min(1).max(20).default(4),
}).superRefine((s, ctx) => {
  if (s.type === 'adzuna' && (!s.countryCode || !['au','at','be','br','ca','ch','de','es','fr','gb','in','it','mx','nl','nz','pl','sg','us','za'].includes(s.countryCode)))
    ctx.addIssue({ code: 'custom', message: 'Select a supported Adzuna country; account access still must be confirmed.' });
  if (['jobicy', 'adzuna', 'usajobs'].includes(s.type) && (s.intervalMinutes < 60 || !s.publicListing))
    ctx.addIssue({ code: 'custom', message: 'Public source attribution and at least an hourly interval required.' });
  if (s.enabled && !s.approved) ctx.addIssue({ code: 'custom', message: 'Source must be approved before enabling.' });
  if (['ashby', 'greenhouse', 'lever'].includes(s.type) && (!s.board || !s.company))
    ctx.addIssue({ code: 'custom', message: 'Employer boards require a board identifier and confirmed company name.' });
  if (s.type === 'remotive' && (s.intervalMinutes < 360 || !s.publicListing))
    ctx.addIssue({ code: 'custom', message: 'Remotive requires public attribution, ungated listings and a minimum six-hour interval.' });
});
export type FeedSource = z.infer<typeof sourceSchema>;

export const publicSources: FeedSource[] = [
  { id: 'arbeitnow-europe', type: 'arbeitnow', name: 'Arbeitnow', enabled: true, approved: true,
    policyEvidence: 'Public job aggregation API: https://www.arbeitnow.com/blog/job-board-api', publicListing: true, publish: true, intervalMinutes: 60, maxPages: 4 },
  { id: 'arbeitnow-uk', type: 'arbeitnow-uk', name: 'Arbeitnow UK', enabled: true, approved: true,
    policyEvidence: 'Public UK job aggregation API: https://www.arbeitnow.com/blog/job-board-api', publicListing: true, publish: true, intervalMinutes: 60, maxPages: 4 },
  { id: 'remotive-global', type: 'remotive', name: 'Remotive', enabled: true, approved: true,
    policyEvidence: 'Public syndication with original-link attribution, ungated listings, no Google Jobs distribution: https://github.com/remotive-com/remote-jobs-api', publicListing: true, publish: true, intervalMinutes: 360, maxPages: 1 },
  { id: 'jobicy-global', type: 'jobicy', name: 'Jobicy', enabled: true, approved: true,
    policyEvidence: 'Public API permits job discovery with canonical source attribution: https://jobicy.com/jobs-rss-feed', publicListing: true, publish: true, intervalMinutes: 360, maxPages: 1 },
];
