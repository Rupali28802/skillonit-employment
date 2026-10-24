import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

type CsvRow = Record<string, string>;
type Occupation = { id: string; slug: string; displayName: string; parentId: string | null; aliases: string[]; active: boolean; relatedRoleIds: string[]; mappings: { scheme: string; code: string; version: string }[] };
type Skill = { id: string; slug: string; displayName: string; aliases: string[]; active: boolean };

const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const key = (row: CsvRow, ...names: string[]) => {
  const keys = new Map(Object.keys(row).map(name => [normalizeHeader(name), name]));
  for (const name of names) { const found = keys.get(normalizeHeader(name)); if (found) return row[found].trim(); }
  return '';
};
const idFromUri = (uri: string) => {
  const id = uri.replace(/[/?#]+$/, '').split(/[/?#]/).filter(Boolean).at(-1) || '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id)) throw new Error('Unsupported ESCO concept URI');
  return id;
};
const slug = (label: string, id: string, used: Set<string>) => {
  const base = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160) || `esco-${id}`;
  let value = base, attempt = 0;
  while (used.has(value)) value = `${base.slice(0, 160)}-${id.slice(0, 8)}${attempt ? `-${attempt}` : ''}`.slice(0, 180), attempt++;
  used.add(value); return value;
};

/** Small CSV reader for official ESCO RFC-4180-style exports; it preserves quoted commas and newlines. */
export function parseCsv(source: string): CsvRow[] {
  const records: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) { if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; } else if (char === '"') quoted = false; else cell += char; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(cell); cell = ''; continue; }
    if (char === '\n') { row.push(cell.replace(/\r$/, '')); records.push(row); row = []; cell = ''; continue; }
    cell += char;
  }
  if (quoted) throw new Error('Malformed CSV quoting');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); records.push(row); }
  const [headers, ...values] = records;
  if (!headers?.length) throw new Error('CSV header missing');
  return values.filter(record => record.some(value => value.trim())).map(record => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])));
}

export function escoOccupations(rows: CsvRow[]): Occupation[] {
  const raw = rows.map(row => ({ uri: key(row, 'Concept URI', 'conceptUri'), type: key(row, 'Concept type', 'conceptType'), label: key(row, 'Concept PT', 'preferredLabel'), parent: key(row, 'Parent Concept URI', 'parentConceptUri'), iscoCode: key(row, 'ISCO code', 'ISCO-08 code', 'iscoCode') })).filter(row => row.uri && row.label);
  if (!raw.length) throw new Error('No ESCO occupations found');
  if (raw.some(row => row.type && !['OC', 'OG'].includes(row.type))) throw new Error('Unexpected ESCO occupation concept type');
  const known = new Set(raw.map(row => row.uri));
  if (raw.some(row => row.parent && !known.has(row.parent))) throw new Error('ESCO occupation parent missing from package');
  const byUri = new Map(raw.map(row => [row.uri, row])); const visited = new Set<string>(), visiting = new Set<string>(), ordered: typeof raw = [];
  const visit = (uri: string) => { if (visited.has(uri)) return; if (visiting.has(uri)) throw new Error('ESCO occupation hierarchy cycle'); visiting.add(uri); const row = byUri.get(uri)!; if (row.parent) visit(row.parent); visiting.delete(uri); visited.add(uri); ordered.push(row); };
  for (const row of raw) visit(row.uri);
  const used = new Set<string>();
  return ordered.map(row => {
    const id = idFromUri(row.uri);
    // ESCO publishes an ISCO-08 mapping alongside the concept. Preserve it
    // verbatim when present rather than asking matching code to infer one.
    const mappings = [
      { scheme: 'ESCO', code: id, version: '1.2.1' },
      ...(row.iscoCode ? [{ scheme: 'ISCO-08', code: row.iscoCode, version: '2008' }] : []),
    ];
    return { id, slug: slug(row.label, id, used), displayName: row.label.slice(0, 200), parentId: row.parent ? idFromUri(row.parent) : null, aliases: [], active: true, relatedRoleIds: [], mappings };
  });
}

export function escoSkills(rows: CsvRow[]): Skill[] {
  const used = new Set<string>(); const seen = new Set<string>();
  const skills = rows.map(row => ({ uri: key(row, 'Concept URI', 'conceptUri'), type: key(row, 'Concept type', 'conceptType'), label: key(row, 'Concept PT', 'preferredLabel') })).filter(row => row.uri && row.label);
  if (!skills.length) throw new Error('No ESCO skills found');
  return skills.map(row => { if (row.type && !['SK', 'SG'].includes(row.type)) throw new Error('Unexpected ESCO skill concept type'); const id = idFromUri(row.uri); if (seen.has(id)) throw new Error('Duplicate ESCO skill URI'); seen.add(id); return { id, slug: slug(row.label, id, used), displayName: row.label.slice(0, 200), aliases: [], active: true }; });
}

export function buildBatches(occupations: Occupation[], skills: Skill[], batchSize = 500, finalizeManaged = false) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('Batch size must be 1–500');
  const batches: Record<string, unknown>[] = [];
  for (let index = 0; index < occupations.length; index += batchSize) batches.push({ occupations: occupations.slice(index, index + batchSize), skills: [], locations: [] });
  for (let index = 0; index < skills.length; index += batchSize) batches.push({ occupations: [], skills: skills.slice(index, index + batchSize), locations: [] });
  if (!batches.length) throw new Error('No taxonomy batches created');
  if (finalizeManaged) batches.at(-1)!.metadata = { version: 'ESCO-1.2.1', source: 'managed', occupationScheme: 'ESCO', license: 'Review official ESCO license before production import' };
  return batches;
}

function argument(name: string) { const position = process.argv.indexOf(name); return position >= 0 ? process.argv[position + 1] : undefined; }
async function main() {
  const occupationsPath = argument('--occupations'), skillsPath = argument('--skills'), output = argument('--out'); const finalize = process.argv.includes('--finalize-managed');
  if (!occupationsPath || !skillsPath || !output || process.argv.includes('--apply')) throw new Error('Usage: import-esco-taxonomy --occupations <csv> --skills <csv> --out <directory> [--finalize-managed]. This command never applies data.');
  const [occupationCsv, skillsCsv] = await Promise.all([readFile(occupationsPath, 'utf8'), readFile(skillsPath, 'utf8')]);
  const occupations = escoOccupations(parseCsv(occupationCsv)), skills = escoSkills(parseCsv(skillsCsv)); const batches = buildBatches(occupations, skills, 500, finalize);
  await mkdir(output, { recursive: true });
  for (const [index, batch] of batches.entries()) await writeFile(path.join(output, `batch-${String(index + 1).padStart(4, '0')}.json`), JSON.stringify(batch));
  const checksum = createHash('sha256').update(occupationCsv).update('\0').update(skillsCsv).digest('hex');
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ source: 'ESCO', version: '1.2.1', occupations: occupations.length, skills: skills.length, batches: batches.length, checksum, finalBatchMarksManaged: finalize }, null, 2) + '\n');
  console.info(JSON.stringify({ occupations: occupations.length, skills: skills.length, batches: batches.length, output: path.resolve(output), finalBatchMarksManaged: finalize }));
}
if (process.argv[1] && process.argv[1].endsWith('import-esco-taxonomy.ts')) main().catch(() => { console.error('ESCO taxonomy transformation failed. Source files were not applied to any database.'); process.exitCode = 1; });
