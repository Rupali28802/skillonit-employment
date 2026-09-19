# Public employer job feeds

From backend/: run `npm install`, `npm run build`, then `npm run jobs:seed-employers` and `npm run worker:jobs`. MongoDB must be configured privately in backend/.env. Existing source settings are preserved on repeated seeding. The versioned configuration contains public board identifiers only.

The versioned employer registry contains individually reviewed public boards. It now includes Paytm and Dun & Bradstreet (Lever) plus Groww and Karya (Greenhouse) for current India internship, trainee and apprentice coverage. Each configured board keeps its original application link and passes through the existing validation, deduplication, risk review, withdrawal and 90-day expiry rules. Do not equate a configured board with an employer partnership or complete ATS coverage; every employer board is reviewed independently.

## India early-career additions — 19 September 2026

| Employer | Public ATS | Verified evidence | Relevant current inventory at review time |
| --- | --- | --- | --- |
| Paytm | Lever | `paytm.com/careers` links to `jobs.lever.co/paytm` | Multiple India internships across recruiting and design |
| Groww | Greenhouse | `groww.in/careers` links to the Groww Greenhouse board | Video and content internships in Bengaluru |
| Karya | Greenhouse | Karya's official team/careers page links to its Greenhouse board | Research Intern — AI Evaluations in Bengaluru |
| Dun & Bradstreet | Lever | Public D&B postings identify `jobs.lever.co/dnb` as the company job board | Intern and apprentice opportunities in Mumbai/Kolkata |

The inventory is refreshed from the public ATS board, so closed postings disappear through snapshot reconciliation. A role is shown as an internship or apprenticeship only when the source provides that fact; missing experience is not converted into “fresher.”

## India fresher-source additions — 19 September 2026

| Employer | Public ATS | Official connection evidence | Current early-career evidence at review time |
| --- | --- | --- | --- |
| BPM | Lever | BPM's careers site has an Early Careers & Students route; its public board links back to BPM | Bengaluru Campus Hires (2026–27), grouped under Associate I (Freshers) |
| Weekday | Lever | Public Weekday board links to `weekday.works` | India Business Development role explicitly accepts freshers and final-year students |
| Nium | Lever | Public Nium board links to Nium | India Junior Executive role explicitly encourages applicants with 0–1 year or fresher experience |
| AHEAD | Lever | AHEAD's official careers page publishes its open positions through Lever | India apprentice/intern roles explicitly aimed at graduates and freshers |
| Zeta | Lever | Zeta's official India careers page loads its job inventory from the Zeta Lever endpoint | Product Management Intern in Bengaluru |
| Fam | Lever | Fam's official jobs page loads its inventory from the `fampay` Lever endpoint | Copy Intern in Bengaluru |
| HighLevel | Lever | HighLevel's official careers page links directly to its Lever board | Two remote India Talent Acquisition apprenticeships |
| CloudSEK | Greenhouse | CloudSEK's official openings page embeds `for=cloudsek` from Greenhouse | Current Bengaluru DevOps, Security Consultant and business-development internships |

Fresher search accepts a job only when the source explicitly says fresher, entry-level, recent graduate, campus hire, graduate recruitment, internship, apprenticeship or trainee, or supplies a structured 0–2 year experience range. Generic junior/associate titles alone are not classified as fresher roles.

Official API references:
- https://docs.greenhouse.io/job-board.html
- https://github.com/lever/postings-api
- https://developers.ashbyhq.com/docs/public-job-posting-api

See JOB_SOURCE_MASTER_AUDIT.html for the broader outstanding source inventory.
