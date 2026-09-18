# Requested job portal access status

Checked 18 September 2026. This list records access truthfully; it is not a claim that the named portals are connected. A portal can be enabled only after SkillonIT has explicit retrieval and display permission, provider credentials, attribution rules, rate limits, expiry/withdrawal behavior and a tested original application link.

| Portal | Current status | Authorized route required |
|---|---|---|
| Naukri | Provider approval required | Commercial syndication or partner feed approved by Naukri. Recruiter posting access is not permission to export search inventory. |
| Indeed | Existing approval request pending | Indeed Partner Console app and scopes for associated employer jobs. The available partner APIs are not an unrestricted worldwide Indeed feed. |
| LinkedIn Jobs | Existing approval request pending | LinkedIn Talent Solutions Partner approval and signed API agreement. Posting/status APIs cover approved partner and customer jobs, not broad public-job retrieval. |
| Glassdoor | Provider approval required | Glassdoor-approved API or distribution agreement with job-listing rights and attribution requirements. |
| Monster | Provider approval required | A Monster agreement granting a third-party job inventory feed. Public integration material describes publishing employer requisitions to Monster. |
| Freshersworld | Official access request submitted 18 September 2026; approval pending | Approved affiliate/partner participation and the data, widgets or links issued under that agreement. The official form confirmed receipt. |
| Shine | Provider approval required | Written permission for retrieval and redisplay. Shine's advertised ATS integration sends employer jobs to Shine; it is not a search-export feed. |
| TimesJobs | Official access unconfirmed | Written API/feed agreement covering retrieval, display, refresh, removal and application links. |
| Internshala | Provider approval required | Written permission for third-party listing display. Its documented job/internship application flow remains on Internshala. |
| Foundit | Provider approval required | Commercial feed or partner agreement expressly permitting retrieval and display. |

The backend exposes the same machine-readable truth at `GET /api/v1/jobs/source-access`. These portals are intentionally absent from `jobFeedSources`, so they cannot inflate the live source count or create unlicensed records.

Existing authorized feeds continue to supply real jobs. Every imported record retains its source and canonical application URL, jobs are refreshed by their configured schedules, and lifecycle processing removes jobs at the provider's earlier closing date or after the platform's 90-day maximum.

Official references:

- Indeed Partner APIs: https://docs.indeed.com/getstarted/
- LinkedIn Apply Connect restrictions: https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/create-apply-connect-jobs
- Glassdoor developer/API terms: https://www.glassdoor.com/developer/index.htm
- Monster staffing integrations: https://hiring.monster.com/solutions/staffing/
- Freshersworld contact and affiliate route: https://www.freshersworld.com/contactus
- Shine recruiter/ATS integration: https://recruiter.shine.com/
- Internshala employer integration information: https://internshala.com/employer/help_center_faq/14
- Foundit employer portal: https://recruiter.foundit.in/
