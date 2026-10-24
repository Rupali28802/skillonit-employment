import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatches, escoOccupations, escoSkills, parseCsv } from '../src/import-esco-taxonomy.ts';

test('ESCO CSV transformation retains stable concept IDs and parent-first batches without applying data', () => {
  const occupations = parseCsv([
    'Concept URI,Concept type,ISCO code,Concept PT,Parent Concept URI',
    'http://data.europa.eu/esco/occupation/root-123,OG,1,Technology occupations,',
    'http://data.europa.eu/esco/occupation/child-456,OC,123,Frontend developer,http://data.europa.eu/esco/occupation/root-123',
  ].join('\n'));
  const skills = parseCsv([
    'Concept URI,Concept type,Concept PT',
    'http://data.europa.eu/esco/skill/html-111,SK,HTML',
    'http://data.europa.eu/esco/skill/react-222,SK,React',
  ].join('\n'));
  const output = buildBatches(escoOccupations(occupations), escoSkills(skills), 1, true);
  assert.equal(output.length, 4);
  assert.deepEqual((output[0].occupations as { id: string; parentId: string | null }[])[0], { id: 'root-123', slug: 'technology-occupations', displayName: 'Technology occupations', parentId: null, aliases: [], active: true, relatedRoleIds: [], mappings: [{ scheme: 'ESCO', code: 'root-123', version: '1.2.1' }, { scheme: 'ISCO-08', code: '1', version: '2008' }] });
  assert.equal((output[1].occupations as { id: string; parentId: string }[])[0].parentId, 'root-123');
  assert.deepEqual((output[1].occupations as { mappings: { scheme: string; code: string }[] }[])[0].mappings.at(-1), { scheme: 'ISCO-08', code: '123', version: '2008' });
  assert.equal((output.at(-1)!.metadata as { source: string }).source, 'managed');
});

test('ESCO transformer rejects malformed hierarchy and never treats --apply as a supported action', () => {
  const rows = parseCsv('Concept URI,Concept type,Concept PT,Parent Concept URI\nhttp://data.europa.eu/esco/occupation/a-123,OC,A,missing-parent\n');
  assert.throws(() => escoOccupations(rows), /parent missing/);
  assert.throws(() => buildBatches([], [], 0), /Batch size/);
});
