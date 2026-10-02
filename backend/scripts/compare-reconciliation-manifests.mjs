import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const [atlasPath, postgresPath, outputPath = '.reconciliation-comparison.json'] = process.argv.slice(2);
if (!atlasPath || !postgresPath) throw new Error('ATLAS_AND_POSTGRES_MANIFESTS_REQUIRED');

async function load(path, expectedLabel) {
  const collections = new Map();
  let header;
  let footer;
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (Array.isArray(row)) {
      if (row.length !== 3 || row.some(value => typeof value !== 'string')) throw new Error(`${expectedLabel}_INVALID_FINGERPRINT`);
      const [collection, id, hash] = row;
      let documents = collections.get(collection);
      if (!documents) collections.set(collection, documents = new Map());
      if (documents.has(id)) throw new Error(`${expectedLabel}_DUPLICATE_ID`);
      documents.set(id, hash);
    } else if (row.manifestVersion) {
      header = row;
    } else if (row.complete === true) {
      footer = row;
    }
  }
  if (!header || !footer) throw new Error(`${expectedLabel}_INCOMPLETE_MANIFEST`);
  const total = [...collections.values()].reduce((sum, rows) => sum + rows.size, 0);
  if (total !== footer.total) throw new Error(`${expectedLabel}_TOTAL_MISMATCH`);
  return { header, footer, collections, total };
}

const [atlas, postgres] = await Promise.all([
  load(atlasPath, 'ATLAS'),
  load(postgresPath, 'POSTGRES'),
]);
const names = [...new Set([...atlas.collections.keys(), ...postgres.collections.keys()])].sort();
const collections = [];
for (const name of names) {
  const source = atlas.collections.get(name) || new Map();
  const target = postgres.collections.get(name) || new Map();
  const atlasOnly = [];
  const postgresOnly = [];
  const different = [];
  let equal = 0;
  for (const [id, hash] of source) {
    if (!target.has(id)) atlasOnly.push(id);
    else if (target.get(id) !== hash) different.push(id);
    else equal++;
  }
  for (const id of target.keys()) if (!source.has(id)) postgresOnly.push(id);
  collections.push({
    collection: name,
    atlas: source.size,
    postgres: target.size,
    equal,
    different: different.length,
    atlasOnly: atlasOnly.length,
    postgresOnly: postgresOnly.length,
    ids: { atlasOnly: atlasOnly.sort(), postgresOnly: postgresOnly.sort(), different: different.sort() },
  });
}
const totals = collections.reduce((result, row) => ({
  equal: result.equal + row.equal,
  different: result.different + row.different,
  atlasOnly: result.atlasOnly + row.atlasOnly,
  postgresOnly: result.postgresOnly + row.postgresOnly,
}), { equal: 0, different: 0, atlasOnly: 0, postgresOnly: 0 });
const report = {
  generatedAt: new Date().toISOString(),
  scope: 'Complete manifest ID/hash comparison. Source and target snapshots were not simultaneous and live writers were not paused.',
  atlas: { startedAt: atlas.header.startedAt, completedAt: atlas.footer.completedAt, total: atlas.total },
  postgres: { startedAt: postgres.header.startedAt, completedAt: postgres.footer.completedAt, total: postgres.total },
  totals,
  collections,
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ atlas: report.atlas, postgres: report.postgres, totals, changedCollections: collections.filter(row => row.different || row.atlasOnly || row.postgresOnly).map(({ ids, ...row }) => row) }));
