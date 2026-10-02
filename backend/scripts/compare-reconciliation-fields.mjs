import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const [atlasPath, postgresPath, outputPath = '.reconciliation-field-summary.json'] = process.argv.slice(2);
if (!atlasPath || !postgresPath) throw new Error('FIELD_MANIFESTS_REQUIRED');
async function load(path, label) {
  const rows = new Map(); let footer;
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of input) {
    const row = JSON.parse(line);
    if (Array.isArray(row)) rows.set(`${row[0]}\u0000${row[1]}`, row[2]);
    else if (row.complete) footer = row;
  }
  if (!footer || footer.total !== rows.size) throw new Error(`${label}_INCOMPLETE`);
  return rows;
}
const [atlas, postgres] = await Promise.all([load(atlasPath, 'ATLAS'), load(postgresPath, 'POSTGRES')]);
const summary = new Map();
let compared = 0, missingAtlas = 0, missingPostgres = 0;
for (const key of new Set([...atlas.keys(), ...postgres.keys()])) {
  const left = atlas.get(key), right = postgres.get(key), collection = key.split('\u0000', 1)[0];
  if (!left) { missingAtlas++; continue; }
  if (!right) { missingPostgres++; continue; }
  compared++;
  let fields = summary.get(collection); if (!fields) summary.set(collection, fields = new Map());
  for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (left[field] !== right[field]) fields.set(field, (fields.get(field) || 0) + 1);
  }
}
const report = { generatedAt: new Date().toISOString(), compared, missingAtlas, missingPostgres,
  collections: [...summary].sort(([a], [b]) => a.localeCompare(b)).map(([collection, fields]) => ({ collection, fields: Object.fromEntries([...fields].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) })) };
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(report));
