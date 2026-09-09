import { z } from 'zod';
import { read, transaction, type Repository } from './store.js';
import { ApiError, audit } from './security.js';
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180);
export const occupationSchema = z.object({ id: identifier, slug, displayName: z.string().trim().min(1).max(200), parentId: identifier.nullable(), aliases: z.array(z.string().trim().min(1).max(200)).max(50), active: z.boolean(), relatedRoleIds: z.array(identifier).max(100) }).strict();
export const locationSchema = z.object({ id: identifier, slug, code: identifier, displayName: z.string().trim().min(1).max(200), type: z.enum(['country', 'region', 'state', 'province', 'union_territory', 'city']), parentId: identifier.nullable(), countryCode: z.string().regex(/^[A-Z]{2}$/), active: z.boolean() }).strict();
export const skillSchema = z.object({ id: identifier, slug, displayName: z.string().trim().min(1).max(200), aliases: z.array(z.string().trim().min(1).max(200)).max(50), active: z.boolean() }).strict();
export const catalogSchema = z.object({ skills: z.array(skillSchema).max(500).default([]), metadata: z.object({ version: z.string().min(1).max(100), source: z.enum(['seed', 'managed']) }).strict().optional(), occupations: z.array(occupationSchema).max(500).default([]), locations: z.array(locationSchema).max(500).default([]) }).strict();
type Occupation = z.infer<typeof occupationSchema>;
type Location = z.infer<typeof locationSchema>;
async function neighborhood<T extends { id: string; parentId: string | null; slug: string }>(r: Repository, collection: string, updates: T[]): Promise<T[]> {
  const rows = new Map<string, T>(), incoming = new Map(updates.map(row => [row.id, row])), visited = new Set<string>();
  const pending = updates.flatMap(row => [row.id, ...(row.parentId ? [row.parentId] : [])]);
  // Indexed direct-child and ancestor reads replace whole-catalog scans.
  for (const row of updates) {
    const clash = (await r.find<T>(collection, { slug: row.slug }, 1))[0];
    if (clash && clash.id !== row.id) throw new ApiError(409, 'CATALOG_SLUG_CONFLICT', 'Catalog slugs must be unique.');
    let cursor = '';
    for (;;) { const children = await r.scan<T>(collection, { parentId: row.id }, cursor, 500); pending.push(...children.map(child => child.id)); if (children.length < 500) break; cursor = children[children.length - 1].id; }
  }
  while (pending.length) {
    const key = pending.pop()!; if (visited.has(key)) continue; visited.add(key);
    const stored = await r.get<T>(collection, key);
    if (stored) { rows.set(key, stored); if (stored.parentId) pending.push(stored.parentId); }
    const changed = incoming.get(key); if (changed?.parentId) pending.push(changed.parentId);
  }
  return [...rows.values()];
}
function graph<T extends { id: string; slug: string; parentId: string | null }>(rows: T[]) {
  const byId = new Map(rows.map(row => [row.id, row]));
  if (new Set(rows.map(row => row.slug)).size !== rows.length) throw new ApiError(409, 'CATALOG_SLUG_CONFLICT', 'Catalog slugs must be unique.');
  for (const row of rows) {
    const seen = new Set([row.id]); let parent = row.parentId;
    while (parent) {
      if (seen.has(parent)) throw new ApiError(400, 'CATALOG_CYCLE', 'Catalog hierarchy must not contain cycles.');
      seen.add(parent); const ancestor = byId.get(parent);
      if (!ancestor) throw new ApiError(400, 'CATALOG_PARENT', 'Catalog parent does not exist.');
      parent = ancestor.parentId;
    }
  }
  return byId;
}
/** Admin/CLI configuration entry point. Batches merge by stable ID; no deletes or hidden seed. */
export async function configureCatalog(actorId: string, input: unknown) {
  const batch = catalogSchema.parse(input);
  return transaction(async r => {
    // Serialize graph edits so disjoint concurrent requests cannot create a cycle.
    const lock = await r.get<{ id: string; revision: number }>('systemConfig', 'student-catalog-revision');
    await r.put('systemConfig', { id: 'student-catalog-revision', revision: (lock?.revision ?? 0) + 1 });
    if (batch.metadata) await r.put('systemConfig', { id: 'student-catalog-policy', value: batch.metadata });
    for (const row of batch.skills) { const existing = (await r.find<{ id: string }>('skills', { slug: row.slug }, 1))[0]; if (existing && existing.id !== row.id) throw new ApiError(409, 'CATALOG_SLUG_CONFLICT', 'Skill slugs must be unique.'); await r.put('skills', row); }
    const occupations = await neighborhood<Occupation>(r, 'occupationFamilies', batch.occupations), locations = await neighborhood<Location>(r, 'locations', batch.locations);
    for (const row of batch.locations) { const clash = (await r.find<Location>('locations', { countryCode: row.countryCode, code: row.code }, 1))[0]; if (clash && clash.id !== row.id) throw new ApiError(409, 'LOCATION_CODE_CONFLICT', 'Location codes must be unique within a country.'); }
    const merge = <T extends { id: string }>(old: T[], updates: T[]) => {
      if (new Set(updates.map(row => row.id)).size !== updates.length) throw new ApiError(400, 'CATALOG_DUPLICATE_ID', 'Duplicate ID in configuration batch.');
      return [...new Map([...old, ...updates].map(row => [row.id, row])).values()];
    };
    const mergedOccupations = merge(occupations, batch.occupations), mergedLocations = merge(locations, batch.locations);
    for (const [updates, existing] of [[batch.occupations, occupations], [batch.locations, locations]] as const) {
      for (const row of updates) {
        const old = existing.find(previous => previous.id === row.id);
        if (old && old.slug !== row.slug) throw new ApiError(409, 'CATALOG_STABLE_SLUG', 'Existing catalog slugs cannot be reassigned.');
      }
    }
    const occupationMap = graph(mergedOccupations), locationMap = graph(mergedLocations);
    for (const row of mergedOccupations) {
      if (row.active && row.parentId && !occupationMap.get(row.parentId)?.active) throw new ApiError(400, 'CATALOG_PARENT', 'Active occupations require an active parent.');
      if (new Set(row.aliases.map(v => v.toLowerCase())).size !== row.aliases.length) throw new ApiError(400, 'CATALOG_ALIAS', 'Aliases must be distinct.');
      if (new Set(row.relatedRoleIds).size !== row.relatedRoleIds.length) throw new ApiError(400, 'CATALOG_RELATED_ROLE', 'Related roles must be distinct existing roles.');
      for (const key of row.relatedRoleIds) if (key === row.id || (!occupationMap.has(key) && !(await r.get('occupationFamilies', key)))) throw new ApiError(400, 'CATALOG_RELATED_ROLE', 'Related roles must be distinct existing roles.');
    }
    if (new Set(mergedLocations.map(row => row.countryCode + ':' + row.code)).size !== mergedLocations.length) throw new ApiError(409, 'LOCATION_CODE_CONFLICT', 'Location codes must be unique within a country.');
    for (const row of mergedLocations) {
      const parent = row.parentId ? locationMap.get(row.parentId) : undefined;
      if (row.active && parent && !parent.active) throw new ApiError(400, 'LOCATION_HIERARCHY', 'Active locations require an active parent.');
      if ((row.type === 'country' && row.parentId !== null) || (row.type !== 'country' && (!parent || parent.countryCode !== row.countryCode || parent.type === 'city')) || (row.type !== 'country' && row.type !== 'city' && parent?.type !== 'country') || (row.type === 'union_territory' && row.countryCode !== 'IN')) throw new ApiError(400, 'LOCATION_HIERARCHY', 'Invalid country, subdivision or city relationship.');
    }
    for (const row of batch.occupations) await r.put('occupationFamilies', row);
    for (const row of batch.locations) await r.put('locations', row);
    await audit(r, actorId, 'catalog.configured', 'student-catalog');
    return { occupationsUpdated: batch.occupations.length, locationsUpdated: batch.locations.length, revision: (lock?.revision ?? 0) + 1 };
  });
}
export async function lookupCatalog(kind: 'occupations' | 'locations' | 'skills', input: unknown) {
  const query = z.object({ parentId: identifier.or(z.literal('root')).optional(), countryCode: z.string().regex(/^[A-Z]{2}$/).optional(), type: locationSchema.shape.type.optional(), after: identifier.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(input);
  if (kind !== 'locations' && (query.countryCode || query.type)) throw new ApiError(400, 'CATALOG_FILTER', 'Location filters do not apply to occupations.');
  return read(async r => {
    const items = await r.scan<Occupation | Location>(kind === 'occupations' ? 'occupationFamilies' : kind === 'skills' ? 'skills' : 'locations', { active: true, ...(query.parentId ? { parentId: query.parentId === 'root' ? null : query.parentId } : {}), ...(query.countryCode ? { countryCode: query.countryCode } : {}), ...(query.type ? { type: query.type } : {}) }, query.after, query.limit + 1);
    const catalog = await r.get<{ value: unknown }>('systemConfig', 'student-catalog-policy');
    return { catalog: catalog?.value ?? { version: 'unmanaged', source: 'seed' }, items: items.slice(0, query.limit), nextCursor: items.length > query.limit ? items[query.limit - 1].id : null };
  });
}
