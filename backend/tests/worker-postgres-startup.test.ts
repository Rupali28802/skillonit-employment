import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

// Reject local connections before authentication: no production database or
// provider is contacted, and no worker can execute a business write.
for (const entry of ['src/job-engine/cli.ts', 'src/matching-index.ts']) {
  test(`${entry} reaches PostgreSQL without MongoDB and fails safely on connection loss`, async () => {
    let connections = 0;
    const server = createServer(socket => { connections++; socket.destroy(); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const env = {
      ...process.env,
      NODE_OPTIONS: '',
      MONGODB_URI: '',
      DEMO_MODE: 'false',
      DATABASE_URL: `postgresql://startup_fixture:private-test-marker@127.0.0.1:${address.port}/isolated_test`,
      DATABASE_SSL: 'false',
      MATCHING_SEARCH_PROVIDER: 'opensearch',
      MATCHING_OPENSEARCH_URL: 'https://search.example.test/',
      MATCHING_OPENSEARCH_AUTHORIZATION: 'Bearer isolated-test',
      MATCHING_OPENSEARCH_INDEX: 'isolated-test',
      MATCHING_SEMANTIC: 'off',
    };
    const child = spawn(process.execPath, ['--import', 'tsx', entry, 'status'], {
      cwd: new URL('..', import.meta.url), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const deadline = setTimeout(() => child.kill(), 30000);
    try {
      const [code] = await once(child, 'close');
      assert.equal(code, 1, 'worker must exit on database failure');
      assert.ok(connections > 0, 'PostgreSQL-only configuration must reach the PostgreSQL driver');
      assert.ok(!output.includes('private-test-marker'));
      assert.ok(!output.includes('postgresql://'));
    } finally {
      clearTimeout(deadline);
      server.close();
    }
  });
}
