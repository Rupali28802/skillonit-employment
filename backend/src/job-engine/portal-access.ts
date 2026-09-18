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
    id: 'naukri', name: 'Naukri', market: 'India', status: 'approval_pending', connected: false,
    officialUrl: 'https://www.naukri.com/recruiter',
    permittedRoute: 'Commercial syndication or partner feed approved by Naukri.',
    note: 'A retrieval and redisplay enquiry was sent to the official Naukri sales channel on 18 September 2026; written approval is pending.',
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
    id: 'glassdoor', name: 'Glassdoor', market: 'Worldwide', status: 'approval_pending', connected: false,
    officialUrl: 'https://www.glassdoor.com/developer/index.htm',
    permittedRoute: 'Glassdoor-approved API or distribution agreement with job-listing rights.',
    note: 'A retrieval and redisplay enquiry was sent to the official Glassdoor employer channel on 18 September 2026; the former developer page currently returns not found.',
  },
  {
    id: 'monster', name: 'Monster', market: 'Worldwide', status: 'provider_approval_required', connected: false,
    officialUrl: 'https://hiring.monster.com/solutions/staffing/',
    permittedRoute: 'Monster partnership granting a job inventory feed for third-party display.',
    note: 'Published material describes sending employer requisitions to Monster. Its global contact form requires a supported-region business postal code; India is not offered, so no truthful submission is possible with the current project details.',
  },
  {
    id: 'freshersworld', name: 'Freshersworld', market: 'India', status: 'approval_pending', connected: false,
    officialUrl: 'https://www.freshersworld.com/contactus',
    permittedRoute: 'Approved affiliate/partner participation using data or widgets supplied by Freshersworld.',
    note: 'An affiliate/feed access enquiry was submitted through the official contact form on 18 September 2026; approval and an issued feed are pending.',
  },
  {
    id: 'shine', name: 'Shine', market: 'India', status: 'approval_pending', connected: false,
    officialUrl: 'https://recruiter.shine.com/',
    permittedRoute: 'Shine partnership that expressly permits retrieval and redisplay.',
    note: 'A retrieval and redisplay enquiry was sent to the official Shine recruiter-services channel on 18 September 2026; approval is pending.',
  },
  {
    id: 'timesjobs', name: 'TimesJobs', market: 'India', status: 'approval_pending', connected: false,
    officialUrl: 'https://www.timesjobs.com/',
    permittedRoute: 'A written TimesJobs feed/API agreement covering retrieval, display and application links.',
    note: 'A feed and API access enquiry was sent to the official TimesJobs recruitment-solutions channel on 18 September 2026; a supported route is pending confirmation.',
  },
  {
    id: 'internshala', name: 'Internshala', market: 'India', status: 'approval_pending', connected: false,
    officialUrl: 'https://internshala.com/hire-talent/',
    permittedRoute: 'Internshala partnership expressly permitting third-party listing display.',
    note: 'A retrieval and redisplay enquiry was sent through Internshala\'s official general contact channel on 18 September 2026; permission is pending.',
  },
  {
    id: 'foundit', name: 'Foundit', market: 'India and international', status: 'approval_pending', connected: false,
    officialUrl: 'https://recruiter.foundit.in/',
    permittedRoute: 'Foundit commercial partnership granting a retrieval/display feed.',
    note: 'A retrieval and redisplay enquiry was sent to the official Foundit sales channel on 18 September 2026; approval is pending.',
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
