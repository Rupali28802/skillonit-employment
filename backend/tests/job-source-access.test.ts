import test from 'node:test';
import assert from 'node:assert/strict';
import { publicPortalAccess, requestedPortalAccess } from '../src/job-engine/portal-access.ts';

test('requested portals remain pending until explicit retrieval and display access exists', () => {
  assert.deepEqual(
    requestedPortalAccess.map(source => source.id),
    ['naukri', 'indeed', 'linkedin', 'glassdoor', 'monster', 'freshersworld', 'shine', 'timesjobs', 'internshala', 'foundit'],
  );
  assert.ok(requestedPortalAccess.every(source => source.connected === false));
  assert.ok(requestedPortalAccess.every(source => source.officialUrl.startsWith('https://')));
  assert.ok(requestedPortalAccess.every(source => source.permittedRoute.length > 20));
  const report = publicPortalAccess();
  assert.equal(report.connected, 0);
  assert.equal(report.pending, 10);
});
