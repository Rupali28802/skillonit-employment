import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { checkStudentProfile } from './student-profile-checks.js';
import { checkModule2 } from './module2-checks.js';
import { checkModule2Foundation } from './module2-foundation-checks.js';
import { bootstrapIndexes, closeStore, read, transaction } from '../src/lib/store.js';
import { configureCatalog } from '../src/lib/student-catalog.js';
import { module2Limit } from '../src/lib/module2-config.js';

// Never load .env, use Atlas, or invoke the cross-module integration suite.
test('Module 2 isolated MongoDB replica-set API workflows, indexes and integrity', async () => {
  const env = { ...process.env };
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const client = new MongoClient(replica.getUri());
  try {
    Object.assign(process.env, { MONGODB_URI: replica.getUri(), MONGODB_DATABASE: 'architecture_test', DEMO_MODE: 'true', APP_URL: 'http://localhost:3000' });
    await bootstrapIndexes(); await bootstrapIndexes();
    const messages: string[] = [];
    const methods = ['info', 'warn', 'error', 'log'] as const;
    const originals = methods.map(method => console[method]);
    try {
      for (const method of methods) console[method] = (...args: unknown[]) => { messages.push(JSON.stringify(args)); };
      await checkStudentProfile();
      await checkModule2();
      await checkModule2Foundation();
    } finally { methods.forEach((method, i) => { console[method] = originals[i]; }); }
    const output = messages.join('\n');
    for (const forbidden of ['Candidate confirmed education', 'Candidate supplied education', 'Unconfirmed extraction', 'private scanner error', 'private parser error', 'private upload error', 'private delete error', 'mongodb://', 'skillonit_session=']) {
      assert.ok(!output.includes(forbidden), 'Sensitive fixture content must not appear in application logs');
    }
    assert.ok(messages.some(line => line.includes('cv.processing_completed')), 'Structured worker log redaction was exercised');
    const priorLimit = process.env.MODULE2_MUTATIONS_PER_MINUTE;
    try {
      process.env.MODULE2_MUTATIONS_PER_MINUTE = '1';
      await module2Limit('isolated-rate-limit-probe', 'mutation');
      await assert.rejects(module2Limit('isolated-rate-limit-probe', 'mutation'), { code: 'RATE_LIMIT' });
    } finally {
      if (priorLimit === undefined) delete process.env.MODULE2_MUTATIONS_PER_MINUTE;
      else process.env.MODULE2_MUTATIONS_PER_MINUTE = priorLimit;
    }
    const db = client.db('architecture_test');
    const required: [string, Record<string, number>, boolean?][] = [
      ['studentOnboarding', { userId: 1 }, true],
      ['studentPreferences', { userId: 1 }, true],
      ['automationPreferences', { userId: 1 }, true],
      ['candidateConsents', { userId: 1, purpose: 1 }, true],
      ['candidateConsentEvents', { userId: 1, updatedAt: -1 }],
      ['occupationFamilies', { slug: 1 }, true],
      ['occupationFamilies', { parentId: 1, active: 1 }],
      ['occupationFamilies', { 'mappings.scheme': 1, 'mappings.code': 1 }],
      ['taxonomyMappings', { kind: 1, scheme: 1, code: 1 }, true],
      ['taxonomyTerms', { kind: 1, normalized: 1, ownerId: 1 }, true],
      ['taxonomyTerms', { kind: 1, ownerId: 1 }],
      ['locations', { slug: 1 }, true],
      ['locations', { countryCode: 1, code: 1 }, true],
      ['locations', { parentId: 1, active: 1 }],
      ['locations', { countryCode: 1, type: 1, active: 1 }],
      ['locations', { 'mappings.scheme': 1, 'mappings.code': 1 }],
      ['skills', { slug: 1 }, true],
      ['cvDocuments', { userId: 1, createdAt: -1 }],
      ['cvDocuments', { userId: 1, sha256: 1 }],
      ['cvDocuments', { status: 1, leaseUntil: 1 }],
      ['cvDocuments', { status: 1, updatedAt: 1 }],
      ['cvDocuments', { expiresAt: 1 }],
      ['cvVersions', { userId: 1, documentId: 1 }],
      ['atsCvDrafts', { userId: 1, createdAt: -1 }],
      ['auditLogs', { actorId: 1, createdAt: -1 }],
    ];
    for (const [collection, key, unique] of required) {
      const indexes = await db.collection(collection).indexes();
      assert.ok(indexes.some(index => JSON.stringify(index.key) === JSON.stringify(key) && (!unique || index.unique)), `${collection}: required index`);
      assert.ok(indexes.some(index => index.key.id === 1 && index.unique), `${collection}: stable unique ID`);
    }
    assert.ok((await db.collection('locations').indexes()).some(index => index.key.geo === '2dsphere'), 'locations: future geospatial index');
    assert.ok((await db.collection('cvDeletionReceipts').indexes()).some(index => index.key.expiresAtDate === 1 && index.expireAfterSeconds === 0));
    for (const collection of ['studentPreferences', 'automationPreferences', 'studentOnboarding', 'candidateConsents']) {
      const row = await db.collection(collection).findOne({}); assert.ok(row);
      const { _id, ...copy } = row;
      await assert.rejects(db.collection(collection).insertOne({ ...copy, id: 'duplicate-owner-probe' }), { code: 11000 });
    }
    await assert.rejects(transaction(async r => {
      await r.put('studentPreferences', { id: 'rollback-probe', userId: 'rollback-probe' });
      throw new Error('Deliberate isolated rollback');
    }));
    assert.equal(await read(r => r.get('studentPreferences', 'rollback-probe')), null);
    // IDs belong to separate taxonomy namespaces; immutable slugs are checked within each.
    const occupation = { id: 'shared-taxonomy-id', slug: 'shared-occupation', displayName: 'Fixture occupation', parentId: null, aliases: [], active: true, relatedRoleIds: [] };
    const location = { id: occupation.id, slug: 'shared-location', displayName: 'Fixture country', code: 'ZZ', countryCode: 'ZZ', type: 'country', parentId: null, active: true };
    await configureCatalog('isolated-test', { occupations: [occupation], locations: [location] });
    await configureCatalog('isolated-test', { occupations: [occupation], locations: [location] });
    await assert.rejects(configureCatalog('isolated-test', { locations: [{ ...location, slug: 'changed-location' }] }), { code: 'CATALOG_STABLE_SLUG' });
  } finally {
    await closeStore(); await client.close(); await replica.stop(); process.env = env;
  }
});
