import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchFeed } from '../src/job-engine/adapters.ts';
import { normalize } from '../src/job-engine/normalize.ts';
import { configuredHeadcountLabsSource } from '../src/job-engine/sources.ts';

test('Headcount Labs follows cursors and requires fresh checks on the same posting', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-13T12:00:00Z'));
  const previousKey = process.env.HEADCOUNT_LABS_API_KEY;
  process.env.HEADCOUNT_LABS_API_KEY = 'fixture-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.HEADCOUNT_LABS_API_KEY;
    else process.env.HEADCOUNT_LABS_API_KEY = previousKey;
  });
  const [source] = configuredHeadcountLabsSource();
  const posting = {
    posting_status: 'listed',
    posting_url: { value: 'https://careers.example.com/jobs/one' },
    application_url: { value: 'https://careers.example.com/jobs/one/apply' },
    last_completed_fetch_at: '2026-11-13T06:00:00Z',
    latest_application_check: { result: 'available', checked_at: '2026-11-13T09:00:00Z' },
    attribution: { required: false },
  };
  const job = {
    job_id: 'fixture-job', currentness: 'current', stale: false,
    title: { value: 'Software Engineer' }, employer_name: { value: 'Example Employer' },
    description: { value: 'Employer text' }, postings: [posting],
    locations: [{ value: { country: 'IN', city: 'Pune' } }],
  };
  const batch = await fetchFeed(source, async (raw, headers) => {
    const url = new URL(raw);
    assert.equal(url.origin, 'https://api.headcountlabs.com');
    assert.equal(headers?.Authorization, 'Bearer fixture-key');
    assert.equal(url.searchParams.get('application_check_since'), '2026-11-12T12:00:00.000Z');
    return url.searchParams.get('cursor') === 'page-two'
      ? { data: [job], next_cursor: null }
      : { next_cursor: 'page-two', data: [
        { ...job, postings: [
          { ...posting, last_completed_fetch_at: '2026-11-10T00:00:00Z' },
          { ...posting, latest_application_check: { ...posting.latest_application_check, result: 'closed' } },
        ] },
        { ...job, postings: [{ ...posting, attribution: { required: true } }] },
      ] };
  });
  assert.equal(batch.requests, 2);
  assert.equal(batch.complete, true);
  assert.equal(batch.snapshot, false);
  assert.equal(batch.jobs.length, 1);
  const imported = normalize(batch.jobs[0], source);
  assert.equal(imported.status, 'published');
  assert.equal(imported.url, posting.application_url.value);
  assert.equal(imported.expiresAt, '2026-11-14T06:00:00.000Z');
  assert.doesNotMatch(imported.description, /Employer text/);
});
