import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('global occupation and location catalogs preserve standards, hierarchy, aliases and geo fields', async () => {
  const cwd = process.cwd(), env = { ...process.env }, dir = await mkdtemp(path.join(tmpdir(), 'skillonit-taxonomy-'));
  try {
    process.chdir(dir); delete process.env.MONGODB_URI; process.env.DEMO_MODE = 'true';
    const { configureCatalog, lookupCatalog, resolveCatalogReference, resolveJobTaxonomy, validateTaxonomyReferences } = await import('../src/lib/student-catalog.ts');
    const { transaction } = await import('../src/lib/store.ts');
    const occupations = [
      { id: 'occ-family', slug: 'professionals', displayName: 'Professionals', parentId: null, aliases: [], active: true, relatedRoleIds: [], mappings: [{ scheme: 'ISCO-08', code: '2' }] },
      { id: 'occ-group', slug: 'software-professionals', displayName: 'Software Professionals', parentId: 'occ-family', aliases: ['Software specialists'], active: true, relatedRoleIds: [], mappings: [{ scheme: 'ISCO-08', code: '251' }] },
      { id: 'occ-role', slug: 'software-developer', displayName: 'Software Developer', parentId: 'occ-group', aliases: ['Application Developer'], localizedNames: [{ locale: 'hi', value: 'सॉफ्टवेयर डेवलपर' }], active: true, relatedRoleIds: [], mappings: [{ scheme: 'ISCO-08', code: '2512', version: '2008' }] },
    ];
    const locations = [
      { id: 'loc-country-in', slug: 'india', code: 'IN', displayName: 'India', type: 'country' as const, parentId: null, countryCode: 'IN', active: true, mappings: [{ scheme: 'ISO-3166-1', code: 'IN' }] },
      { id: 'loc-region-west', slug: 'western-india', code: 'WEST', displayName: 'Western India', type: 'region' as const, parentId: 'loc-country-in', countryCode: 'IN', active: true },
      { id: 'loc-state-mh', slug: 'maharashtra', code: 'MH', displayName: 'Maharashtra', type: 'state' as const, parentId: 'loc-region-west', countryCode: 'IN', aliases: ['State of Maharashtra'], active: true, mappings: [{ scheme: 'ISO-3166-2', code: 'IN-MH' }] },
      { id: 'loc-city-pune', slug: 'pune', code: 'PUNE', displayName: 'Pune', type: 'city' as const, parentId: 'loc-state-mh', countryCode: 'IN', aliases: ['Poona'], localizedNames: [{ locale: 'mr', value: 'पुणे' }], coordinates: { latitude: 18.5204, longitude: 73.8567 }, active: true },
    ];
    await configureCatalog('taxonomy-test', { metadata: { version: 'test-v1', source: 'managed', occupationScheme: 'ISCO-08', locationScheme: 'ISO-3166' }, occupations, locations });
    const role = await resolveCatalogReference('occupation', { scheme: 'ISCO-08', code: '2512' });
    assert.equal(role?.id, 'occ-role'); assert.deepEqual(role?.ancestorIds, ['occ-family', 'occ-group']); assert.equal(role?.depth, 2);
    assert.equal((await resolveCatalogReference('occupation', { label: 'सॉफ्टवेयर डेवलपर' }))?.id, 'occ-role');
    const city = await resolveCatalogReference('location', { label: 'Poona', countryCode: 'IN', type: 'city' });
    assert.equal(city?.id, 'loc-city-pune'); assert.deepEqual(city?.ancestorIds, ['loc-country-in', 'loc-region-west', 'loc-state-mh']); assert.deepEqual((city as { geo?: unknown }).geo, { type: 'Point', coordinates: [73.8567, 18.5204] });
    assert.equal((await lookupCatalog('locations', { q: 'पुणे', countryCode: 'IN' })).items[0].id, city?.id);
    await transaction(async repository => { assert.deepEqual(await resolveJobTaxonomy(repository, { occupation: { scheme: 'ISCO-08', code: '2512' }, location: { label: 'Pune', countryCode: 'IN' } }), { occupationId: 'occ-role', locationId: 'loc-city-pune' }); await validateTaxonomyReferences(repository, { occupationId: 'occ-role', locationId: 'loc-city-pune' }); });
    await assert.rejects(transaction(repository => validateTaxonomyReferences(repository, { occupationId: 'missing' })), { code: 'OCCUPATION_REFERENCE' });
    await assert.rejects(configureCatalog('taxonomy-test', { occupations: [{ ...occupations[2], id: 'other-role', slug: 'other-role' }] }), { code: 'CATALOG_MAPPING_CONFLICT' });
    await assert.rejects(configureCatalog('taxonomy-test', { locations: [{ ...locations[3], id: 'bad-city', slug: 'bad-city', code: 'BAD', countryCode: 'US' }] }), { code: 'LOCATION_HIERARCHY' });
    await configureCatalog('taxonomy-test', { occupations: [{ id: 'ambiguous-one', slug: 'ambiguous-one', displayName: 'First Role', parentId: 'occ-family', aliases: ['Shared role'], active: true, relatedRoleIds: [] }, { id: 'ambiguous-two', slug: 'ambiguous-two', displayName: 'Second Role', parentId: 'occ-family', aliases: ['Shared role'], active: true, relatedRoleIds: [] }] });
    await assert.rejects(resolveCatalogReference('occupation', { label: 'Shared role' }), { code: 'CATALOG_AMBIGUOUS' });
  } finally { process.chdir(cwd); process.env = env; await rm(dir, { recursive: true, force: true }); }
});
