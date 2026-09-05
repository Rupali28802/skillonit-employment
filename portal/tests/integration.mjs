import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw Error('Integration fixtures are restricted to local test servers.');
function client() {
  let cookie = '';
  return async (path, method = 'GET', body, expected = 200) => {
    const r = await fetch(base + '/api/v1/' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (r.headers.get('set-cookie'))
      cookie = r.headers.get('set-cookie').split(';')[0];
    const j = await r.json();
    assert.equal(
      r.status,
      expected,
      `${method} ${path}: ${JSON.stringify(j.error)}`,
    );
    return j.data;
  };
}
const visitor = client(),
  student = client(),
  employer = client(),
  admin = client();
const health = await visitor('health');
assert.equal(health.mode, 'demo', 'Test server must use DEMO_MODE=true');
await visitor('admin/overview', 'GET', null, 401);
await visitor('me/profile', 'GET', null, 401);
let jobs = await visitor('jobs?q=remote');
assert.ok(jobs.jobs.length > 0);
assert.ok(jobs.jobs.every((j) => j.mode === 'Remote' && !j.identityVisible));
assert.ok(!JSON.stringify(jobs).includes('Example employer'));
jobs = await visitor('jobs?country=India&experience=0');
assert.ok(
  jobs.jobs.every((j) => j.country === 'India' && j.experienceMin === 0),
);
await student('auth/demo', 'POST', { role: 'student' });
await student('admin/overview', 'GET', null, 403);
await student('me/profile', 'PUT', { name: 'Invalid' }, 400);
await student('jobs/sample-1/save', 'POST', {});
const saved = await student('me/saved');
assert.ok(saved.some((j) => j.id === 'sample-1'));
await student('mail/connect', 'POST', {}, 503);
await student('billing/checkout', 'POST', { planCode: 'premium' }, 503);
await student('webhooks/razorpay', 'POST', {}, 401);
await employer('auth/demo', 'POST', { role: 'employer' });
await employer(
  'employers',
  'POST',
  {
    name: 'Integration Test Organization',
    domain: 'example.test',
    country: 'India',
    description: 'Synthetic organization for local integration tests only.',
  },
  201,
);
const input = {
  title: 'Integration Test Developer',
  category: 'Technology',
  country: 'India',
  state: 'Karnataka',
  city: 'Bengaluru',
  skills: ['React', 'TypeScript', 'CSS'],
  mode: 'Hybrid',
  type: 'Full-time',
  salaryMin: 500000,
  salaryMax: 800000,
  currency: 'INR',
  experienceMin: 0,
  experienceMax: 5,
  description:
    'Synthetic vacancy created only for the local end-to-end verification suite.',
  requirements: 'Confirmed relevant skills and experience.',
  method: 'direct',
};
const job = await employer('employer/jobs', 'POST', input, 201);
assert.equal(job.status, 'review');
await visitor('jobs/' + job.id, 'GET', null, 404);
await admin('auth/demo', 'POST', { role: 'admin' });
await admin('admin/jobs/' + job.id, 'PATCH', { status: 'published' }, 409);
await admin('admin/employers/demo-employer', 'PATCH', { status: 'verified' });
await admin('admin/jobs/' + job.id, 'PATCH', { status: 'published' });
await visitor('jobs/' + job.id);
const application = await student(
  'applications',
  'POST',
  { jobId: job.id },
  201,
);
assert.equal(application.status, 'DIRECT_SUBMITTED');
const duplicate = await student('applications', 'POST', { jobId: job.id }, 201);
assert.equal(duplicate.id, application.id);
const applicants = await employer('employer/applicants');
assert.ok(applicants.some((a) => a.id === application.id));
await employer('employer/applicants/' + application.id, 'PATCH', {
  status: 'SHORTLISTED',
});
const history = await student('applications');
assert.equal(
  history.find((a) => a.id === application.id).status,
  'SHORTLISTED',
);
await student('applications/' + application.id + '/withdraw', 'POST', {});
await employer(
  'employer/applicants/' + application.id,
  'PATCH',
  { status: 'OFFER' },
  409,
);
await employer('employer/jobs/' + job.id, 'PATCH', {});
await visitor('jobs/' + job.id, 'GET', null, 404);
await visitor(
  'contact',
  'POST',
  {
    name: 'Integration test',
    email: 'integration@example.test',
    subject: 'Local test enquiry',
    message: 'This is a synthetic contact form test.',
    consent: true,
  },
  201,
);
const leads = await admin('admin/leads');
assert.ok(leads.some((l) => l.subject === 'Local test enquiry'));
const audits = await admin('admin/audit');
assert.ok(audits.some((a) => a.entityId === application.id));
const cross = await fetch(base + '/api/v1/contact', {
  method: 'POST',
  headers: {
    Origin: 'https://untrusted.example',
    'Content-Type': 'application/json',
  },
  body: '{}',
});
assert.equal(cross.status, 403);
await student('auth/logout', 'POST', {});
await student('me', 'GET', null, 401);
console.log(
  'PASS: 36 API assertions covering search, RBAC, CSRF, validation, provider failures, employer verification, publication, idempotent application, recruiter status, withdrawal, closure, contact and audit.',
);
