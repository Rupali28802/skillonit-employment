import assert from 'node:assert/strict';
const ui = process.env.TEST_FRONTEND || 'http://localhost:3000';
const api = process.env.TEST_URL || 'http://localhost:4000';
for (const url of [ui, api])
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const roles = ['student', 'employer', 'admin'];
const cookies = await Promise.all(
  roles.map(async (role) => {
    const response = await fetch(ui + '/api/v1/auth/demo', {
      method: 'POST',
      headers: { Origin: ui, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    assert.equal(response.status, 200);
    const header = response.headers.get('set-cookie');
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    return header.split(';')[0];
  }),
);
await Promise.all(
  roles.map(async (role, index) => {
    for (let request = 0; request < 5; request++) {
      const result = await fetch(ui + '/api/v1/session', {
        headers: { Cookie: cookies[index] },
      }).then((r) => r.json());
      assert.equal(
        result.data.user.role,
        role,
        'Concurrent sessions must stay isolated',
      );
      assert.equal(result.data.user.passwordHash, undefined);
    }
  }),
);
const anonymous = await fetch(ui + '/api/v1/session').then((r) => r.json());
assert.equal(anonymous.data.user, null);
const pages = [
  [
    '',
    'about',
    'trust',
    'privacy',
    'terms',
    'contact',
    'pricing',
    'login',
    'register',
    'jobs/sample-1',
    'jobs',
    'search',
    'faq',
    'cookies',
    'employer-pricing',
  ],
  [
    'dashboard',
    'profile',
    'preferences',
    'saved',
    'applications',
    'cvs',
    'templates',
    'mail',
    'automation',
    'billing',
    'settings',
    'saved-searches',
    'notifications',
    'assistant',
  ],
  [
    'employer',
    'employer/organization',
    'employer/jobs',
    'employer/post',
    'employer/applicants',
    'employer/team',
    'employer/billing',
  ],
  [
    'admin',
    ...[
      'users',
      'employers',
      'jobs',
      'sources',
      'applications',
      'fraud',
      'plans',
      'payments',
      'leads',
      'content',
      'flags',
      'queues',
      'audit',
      'privacy',
    ].map((p) => 'admin/' + p),
  ],
];
let count = 0;
for (const [group, paths] of pages.entries()) {
  for (const path of paths) {
    const response = await fetch(ui + '/' + path, {
      headers: group ? { Cookie: cookies[group - 1] } : {},
    });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /<main/, path);
    assert.doesNotMatch(
      html,
      /Something went wrong|This workspace is restricted|NEXT_HTTP_ERROR_FALLBACK|"digest":"[0-9]+"/,
      path,
    );
    count++;
  }
}
for (const origin of [api, ui]) {
  const controller = new AbortController();
  const stream = await fetch(origin + '/api/v1/jobs/stream', {
    signal: controller.signal,
  });
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const chunk = await stream.body.getReader().read();
  assert.match(new TextDecoder().decode(chunk.value), /event: ready/);
  controller.abort();
}
const cors = await fetch(api + '/api/v1/me', {
  method: 'OPTIONS',
  headers: { Origin: ui },
});
assert.equal(cors.status, 204);
assert.equal(cors.headers.get('access-control-allow-origin'), ui);
assert.equal(cors.headers.get('access-control-allow-credentials'), 'true');
const rejected = await fetch(api + '/api/v1/me', {
  method: 'OPTIONS',
  headers: { Origin: 'https://untrusted.example' },
});
assert.equal(rejected.status, 403);
const large = await fetch(api + '/api/v1/contact', {
  method: 'POST',
  headers: { Origin: ui, 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'x'.repeat(70000) }),
});
assert.equal(large.status, 413);
console.log(
  `PASS: ${count} page renders; isolated role sessions; cookie forwarding; direct/proxied SSE; CORS; body limit.`,
);
