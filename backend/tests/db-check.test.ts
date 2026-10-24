import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseMode } from '../src/db-check.ts';

test('database check selects PostgreSQL before legacy MongoDB without exposing a URL', () => {
  assert.equal(databaseMode({ DATABASE_URL: 'postgresql://redacted', MONGODB_URI: 'mongodb://redacted' }), 'postgres');
  assert.equal(databaseMode({ MONGODB_URI: 'mongodb://redacted' }), 'mongo');
  assert.equal(databaseMode({}), 'none');
});