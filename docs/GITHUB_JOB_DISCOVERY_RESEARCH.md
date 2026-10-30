# GitHub hiring-post discovery: approval-gated design

## Status

**Not active.** GitHub is not a general job-board feed in SkillOnIT. The connector is intentionally disabled until GitHub gives written permission for this use case and each employer repository is approved.

GitHub's API terms and acceptable-use policy prohibit using API-collected GitHub information for recruiting or job boards without the necessary permission. We must not bulk-search public issues, repositories, profiles, commits, discussions, or code for vacancies, and must never use GitHub data to contact candidates.

## Permitted implementation after written approval

The `github-authorized` source type reads only one explicitly approved, employer-owned repository at a time through GitHub's official `List repository issues` endpoint:

`GET /repos/{owner}/{repo}/issues?state=open&sort=updated&direction=desc&per_page=100`

## Discovery routes assessed

| Route | Status in SkillOnIT | Reason |
| --- | --- | --- |
| Public repository or issue search | Not implemented | A broad API search would collect GitHub service information for a job-board purpose. |
| Public Discussions, profile, README, release, project, commit, or code search | Not implemented | The same job-board/recruiting restriction applies; these are not independently authorized vacancy feeds. |
| An employer's approved hiring repository | Implemented, disabled | The `github-authorized` connector reads only the exact repository after platform approval, employer authorization, and admin approval. |
| Employer-installed GitHub App webhook for that approved repository | Planned after platform approval | This is preferable to polling: the employer explicitly installs the App and GitHub sends changes from that repository. It still needs GitHub's written permission and signed webhook validation before activation. |
| Employer's official careers/ATS source linked from GitHub | Preferred | Integrate the official ATS directly through Greenhouse, Lever, Ashby, SmartRecruiters, or the employer's authorized feed; GitHub can remain attribution only. |

It requires all of the following before a request is made:

1. `GITHUB_JOB_DISCOVERY_APPROVAL_REFERENCE` in private runtime configuration, containing the written GitHub approval reference.
2. A private least-privilege GitHub App installation token in `GITHUB_JOB_DISCOVERY_TOKEN`.
3. A source configuration naming one repository and the confirmed employer, with documented employer permission and publication terms.
4. An administrator-approved source record. New sources are staged with `publish: false`.

## Evidence required for an individual job

The connector accepts an issue only when it is open, comes from the exact approved repository, was written by an owner/member/collaborator, contains job-related terms, provides a non-GitHub HTTPS application link in application/career context, and has a specific role title. Pull requests, generic announcements, personal contact data, GitHub-only links, and posts without an application destination are rejected.

The GitHub issue remains the attributed listing link. The external application URL is kept separately as a source redirect; SkillOnIT does not guess a form URL or submit anything. Existing normalization, risk checks, duplicate fingerprints, 90-day freshness limits, source snapshots, and application-confirmation requirements still apply.

## Rate-limit and operational controls

- One repository per source, one page (maximum 100 open issues), no more frequently than every six hours.
- Authentication is mandatory; no personal access token is accepted as configuration guidance.
- The connector sends GitHub's current API media type and version headers.
- Existing engine cooldown/backoff handles HTTP 403/429 and `Retry-After`; no parallel repository fan-out is enabled.
- A production enhancement before activation should persist `ETag`/`Last-Modified` and issue conditional requests, so unchanged responses return `304 Not Modified`.

## Sources

- GitHub REST API: [List repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues)
- GitHub REST API: [best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- GitHub: [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- GitHub: [Terms of Service, API Terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
- GitHub: [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
