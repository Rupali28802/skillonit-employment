# Verified manual job intake

Use **Admin → Jobs → Add verified job** only when a role cannot be collected by an approved automated connector but its use on SkillonIT is authorised.

Every entry must use facts from the live original listing:

- Job title, company, location, eligibility, description, and requirements.
- The original source page and original application URL (both HTTPS).
- A written authorisation, source terms, partner agreement, or employer-review reference.
- A check that the vacancy is still active, completed within the previous seven days.

The intake endpoint rejects unsafe application URLs and duplicate application links/canonical job identities. New entries are placed in **review**, never published automatically.

To publish a reviewed entry, an administrator must:

1. Open the original source and confirm that the job is active.
2. Confirm the application URL is still the original authorised route.
3. Recheck the authorisation reference and complete the explicit confirmation checkbox.
4. Provide an audit reason and publish.

The platform runs destination and fraud checks before publication. High-risk entries remain blocked for fraud review. Published manual entries expose the source page and original application link to candidates, but never the private authorisation reference.

Do not use this workflow for copied job-board results, expired listings, guessed company details, or sources whose terms prohibit public redistribution.
