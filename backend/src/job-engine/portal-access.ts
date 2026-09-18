export type PortalAccessStatus =
  | 'approval_pending'
  | 'provider_approval_required'
  | 'affiliate_approval_required'
  | 'official_access_unconfirmed';

export type PortalAccess = {
  id: string;
  name: string;
  market: string;
  status: PortalAccessStatus;
  connected: false;
  officialUrl: string;
  permittedRoute: string;
  note: string;
};

// This registry is intentionally separate from jobFeedSources. A portal belongs in
// jobFeedSources only after its owner grants retrieval/display rights and the live
// connector has passed attribution, expiry, withdrawal and source-link tests.
export const requestedPortalAccess: readonly PortalAccess[] = Object.freeze([
  {
    id: 'naukri', name: 'Naukri', market: 'India', status: 'provider_approval_required', connected: false,
    officialUrl: 'https://www.naukri.com/recruiter',
    permittedRoute: 'Commercial syndication or partner feed approved by Naukri.',
    note: 'Recruiter job-posting access does not authorize exporting Naukri search inventory.',
  },
  {
    id: 'indeed', name: 'Indeed', market: 'Worldwide', status: 'approval_pending', connected: false,
    officialUrl: 'https://docs.indeed.com/getstarted/',
    permittedRoute: 'Indeed Partner Console app and the scopes granted for associated employer jobs.',
    note: 'The partner APIs are not an unrestricted feed of every public Indeed job.',
  },
  {
    id: 'linkedin', name: 'LinkedIn Jobs', market: 'Worldwide', status: 'approval_pending', connected: false,
    officialUrl: 'https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/create-apply-connect-jobs',
    permittedRoute: 'LinkedIn Talent Solutions Partner approval and signed API agreement.',
    note: 'Job Posting and status APIs cover approved partner/customer jobs, not broad public-job harvesting.',
  },
  {
    id: 'glassdoor', name: 'Glassdoor', market: 'Worldwide', status: 'provider_approval_required', connected: false,
    officialUrl: 'https://www.glassdoor.com/developer/index.htm',
    permittedRoute: 'Glassdoor-approved API or distribution agreement with job-listing rights.',
    note: 'No approved credentials or current redistribution grant is configured.',
  },
  {
    id: 'monster', name: 'Monster', market: 'Worldwide', status: 'provider_approval_required', connected: false,
    officialUrl: 'https://hiring.monster.com/solutions/staffing/',
    permittedRoute: 'Monster partnership granting a job inventory feed for third-party display.',
    note: 'Published feed integration material describes sending employer requisitions to Monster.',
  },
  {
    id: 'freshersworld', name: 'Freshersworld', market: 'India', status: 'approval_pending', connected: false,
    officialUrl: 'https://www.freshersworld.com/contactus',
    permittedRoute: 'Approved affiliate/partner participation using data or widgets supplied by Freshersworld.',
    note: 'An affiliate/feed access enquiry was submitted through the official contact form on 18 September 2026; approval and an issued feed are pending.',
  },
  {
    id: 'shine', name: 'Shine', market: 'India', status: 'provider_approval_required', connected: false,
    officialUrl: 'https://recruiter.shine.com/',
    permittedRoute: 'Shine partnership that expressly permits retrieval and redisplay.',
    note: 'The documented ATS integration pushes employer jobs to Shine and is not a search-export feed.',
  },
  {
    id: 'timesjobs', name: 'TimesJobs', market: 'India', status: 'official_access_unconfirmed', connected: false,
    officialUrl: 'https://www.timesjobs.com/',
    permittedRoute: 'A written TimesJobs feed/API agreement covering retrieval, display and application links.',
    note: 'No current official public job-retrieval API was verified.',
  },
  {
    id: 'internshala', name: 'Internshala', market: 'India', status: 'provider_approval_required', connected: false,
    officialUrl: 'https://internshala.com/hire-talent/',
    permittedRoute: 'Internshala partnership expressly permitting third-party listing display.',
    note: 'Internshala documents its own application workflow and says employer applications cannot be integrated into an external ATS.',
  },
  {
    id: 'foundit', name: 'Foundit', market: 'India and international', status: 'provider_approval_required', connected: false,
    officialUrl: 'https://recruiter.foundit.in/',
    permittedRoute: 'Foundit commercial partnership granting a retrieval/display feed.',
    note: 'Employer products are available, but no approved public inventory export is configured.',
  },
]);

export function publicPortalAccess() {
  return {
    measuredAt: new Date().toISOString(),
    policy: 'Only sources with explicit retrieval and display permission may become connected job feeds.',
    connected: requestedPortalAccess.filter(source => source.connected).length,
    pending: requestedPortalAccess.filter(source => !source.connected).length,
    sources: requestedPortalAccess,
  };
}
