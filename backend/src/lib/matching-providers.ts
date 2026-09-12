import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Job } from './domain.js';
import type { RankingPolicy } from './matching-contracts.js';
import { matchingId } from './matching-contracts.js';

export class MatchingProviderError extends Error {
  constructor(public readonly code: string) { super(code); }
}
const https = z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; });
const identifier = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,80}$/);
export function matchingProviderConfig(env = process.env) {
  try {
    const provider = z.enum(['local', 'opensearch']).parse(env.MATCHING_SEARCH_PROVIDER || 'local');
    const semantic = z.enum(['off', 'on']).parse(env.MATCHING_SEMANTIC || 'off') === 'on';
    const timeoutMs = z.coerce.number().int().min(100).max(30000).parse(env.MATCHING_PROVIDER_TIMEOUT_MS || '5000');
    const endpoint = provider === 'opensearch' ? https.parse(env.MATCHING_OPENSEARCH_URL) : undefined;
    if (endpoint && new URL(endpoint).pathname !== '/') throw new Error();
    const authorization = provider === 'opensearch' ? z.string().min(1).max(4096).regex(/^(?:Basic|Bearer) [^\r\n]+$/).parse(env.MATCHING_OPENSEARCH_AUTHORIZATION) : undefined;
    const index = identifier.parse(env.MATCHING_OPENSEARCH_INDEX || 'skillonit-jobs-v1');
    const embedding = semantic ? {
      endpoint: https.parse(env.MATCHING_EMBEDDING_URL),
      token: z.string().min(1).max(4096).regex(/^[^\r\n]+$/).parse(env.MATCHING_EMBEDDING_TOKEN),
      model: z.string().min(1).max(200).parse(env.MATCHING_EMBEDDING_MODEL),
      version: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).parse(env.MATCHING_EMBEDDING_VERSION),
      dimensions: z.coerce.number().int().min(2).max(4096).parse(env.MATCHING_EMBEDDING_DIMENSIONS),
    } : undefined;
    if (semantic && provider !== 'opensearch') throw new Error();
    const candidateEmbeddingAllowed = env.MATCHING_ALLOW_CANDIDATE_EMBEDDINGS === 'true';
    return { provider, semantic, endpoint, authorization, index, timeoutMs, embedding, candidateEmbeddingAllowed };
  } catch { throw new MatchingProviderError('MATCHING_PROVIDER_CONFIG'); }
}
export type ProviderConfig = ReturnType<typeof matchingProviderConfig>;

/** HTTPS-only, no redirect following, bounded body/time/retries and sanitized failures. */
export class MatchingTransport {
  private failures = 0;
  private openUntil = 0;
  constructor(private readonly timeoutMs: number, private readonly fetcher: typeof fetch = fetch) {}
  async json(url: string, init: RequestInit, allowMissing = false): Promise<unknown> {
    https.parse(url);
    if (Date.now() < this.openUntil) throw new MatchingProviderError('MATCHING_CIRCUIT_OPEN');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
        if (allowMissing && response.status === 404) { await response.body?.cancel(); return null; }
        if (!response.ok) {
          await response.body?.cancel();
          if (![429, 502, 503, 504].includes(response.status) || attempt === 1) throw new Error();
          await new Promise(resolve => setTimeout(resolve, 100)); continue;
        }
        if (!response.body) throw new Error();
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 16 * 1024 * 1024) throw new Error(); chunks.push(next.value); }
        } finally { await reader.cancel().catch(() => {}); }
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        this.failures = 0; return result;
      } catch {
        this.failures++; if (this.failures >= 3) this.openUntil = Date.now() + 30000;
        throw new MatchingProviderError('MATCHING_PROVIDER_UNAVAILABLE');
      }
    }
    throw new MatchingProviderError('MATCHING_PROVIDER_UNAVAILABLE');
  }
}
export function validateVector(value: unknown, dimensions: number): number[] {
  const vector = z.array(z.number().finite()).length(dimensions).parse(value);
  const norm = Math.hypot(...vector);
  if (!(norm > 0) || !Number.isFinite(norm)) throw new MatchingProviderError('EMBEDDING_INVALID');
  return vector;
}
export function cosine(a: number[], b: number[]) {
  validateVector(a, b.length); validateVector(b, a.length);
  const an = Math.hypot(...a), bn = Math.hypot(...b);
  return Math.max(0, Math.min(1, a.reduce((s, n, i) => s + (n / an) * (b[i] / bn), 0)));
}
export interface EmbeddingProvider { version: string; dimensions: number; embed(text: string): Promise<number[]> }
export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly version: string; readonly dimensions: number;
  constructor(private readonly config: NonNullable<ProviderConfig['embedding']>, private readonly transport: MatchingTransport) {
    this.version = `${config.version}:${config.model}:${config.dimensions}`; this.dimensions = config.dimensions;
  }
  async embed(text: string) {
    if (!text.trim() || text.length > 8000) throw new MatchingProviderError('EMBEDDING_INPUT');
    try {
      const result = z.object({ model: z.string(), data: z.array(z.object({ index: z.literal(0), embedding: z.array(z.number()) })).length(1) })
        .parse(await this.transport.json(this.config.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.config.model, input: text, dimensions: this.dimensions, encoding_format: 'float' }) }));
      if (result.model !== this.config.model) throw new Error();
      return validateVector(result.data[0].embedding, this.dimensions);
    } catch { throw new MatchingProviderError('EMBEDDING_UNAVAILABLE'); }
  }
}
export function jobIndexText(job: Job) {
  return [job.title, job.category, ...job.skills, job.description, job.requirements].join('\n')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '').replace(/https?:\/\/\S+/gi, '').slice(0, 8000);
}
export function jobFingerprint(job: Job) {
  return createHash('sha256').update(JSON.stringify([job.id, job.title, job.category, job.skills, job.description, job.requirements,
    job.country, job.city, job.state, job.mode, job.type, job.salaryMin, job.salaryMax, job.currency, job.experienceMin, job.experienceMax,
    job.status, job.trust, job.discoveredAt, job.expiresAt, job.matching ?? null])).digest('hex');
}
export type SearchHit = { id: string; fingerprint: string; keywordRank?: number; vector?: number[]; vectorVersion?: string };
export interface MatchingSearchProvider {
  retrieve(terms: string[], vector: number[] | undefined, policy: RankingPolicy, now: number): Promise<SearchHit[]>;
  index(job: Job, vector?: number[]): Promise<void>;
  remove(id: string): Promise<void>;
}
export function indexMapping(dimensions?: number) {
  return {
    settings: dimensions ? { 'index.knn': true } : {},
    mappings: { dynamic: 'strict', properties: {
      id: { type: 'keyword' }, fingerprint: { type: 'keyword' }, title: { type: 'text' }, skills: { type: 'text' }, text: { type: 'text' },
      status: { type: 'keyword' }, trust: { type: 'keyword' }, country: { type: 'keyword' }, mode: { type: 'keyword' },
      discoveredAt: { type: 'date' }, expiresAt: { type: 'date' }, vectorVersion: { type: 'keyword' },
      ...(dimensions ? { embedding: { type: 'knn_vector', dimension: dimensions, method: { name: 'hnsw', engine: 'lucene', space_type: 'cosinesimil' } } } : {}),
    } },
  };
}
export function searchFilters(policy: RankingPolicy, now: number) {
  return [{ term: { status: 'published' } }, { term: { trust: 'verified' } },
    { range: { expiresAt: { gt: new Date(now).toISOString() } } },
    { range: { discoveredAt: { gte: new Date(now - policy.maxAgeDays * 86400000).toISOString(), lte: new Date(now).toISOString() } } }];
}
export class OpenSearchMatchingProvider implements MatchingSearchProvider {
  constructor(private readonly config: ProviderConfig, private readonly transport: MatchingTransport, private readonly embeddings?: EmbeddingProvider) {
    if (!config.endpoint || !config.authorization) throw new MatchingProviderError('OPENSEARCH_UNCONFIGURED');
  }
  private call(path: string, method: string, body?: unknown, allowMissing = false) {
    return this.transport.json(`${this.config.endpoint!.replace(/\/$/, '')}/${this.config.index}${path}`, {
      method, headers: { Authorization: this.config.authorization!, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    }, allowMissing);
  }
  async ensureIndex() {
    const existing = await this.call('/_mapping', 'GET', undefined, true);
    if (!existing) { await this.call('', 'PUT', indexMapping(this.embeddings?.dimensions)); return; }
    const mapping = (existing as Record<string, { mappings?: { properties?: Record<string, { type?: string; dimension?: number; method?: { engine?: string; space_type?: string } }> } }>)[this.config.index]?.mappings?.properties;
    const requiredTypes = { id: 'keyword', fingerprint: 'keyword', title: 'text', skills: 'text', text: 'text', status: 'keyword', trust: 'keyword', discoveredAt: 'date', expiresAt: 'date', vectorVersion: 'keyword' };
    if (!mapping || Object.entries(requiredTypes).some(([key, type]) => mapping[key]?.type !== type) ||
      (this.embeddings && (mapping.embedding?.type !== 'knn_vector' || mapping.embedding.dimension !== this.embeddings.dimensions ||
        mapping.embedding.method?.engine !== 'lucene' || mapping.embedding.method.space_type !== 'cosinesimil')))
      throw new MatchingProviderError('OPENSEARCH_REINDEX_REQUIRED');
  }
  async retrieve(terms: string[], vector: number[] | undefined, policy: RankingPolicy, now: number) {
    const filters = searchFilters(policy, now), size = policy.candidatePool;
    const parse = (value: unknown) => z.object({ timed_out: z.boolean().optional(), _shards: z.object({ failed: z.number() }).optional(), hits: z.object({ hits: z.array(z.object({ _id: matchingId, _source: z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), embedding: z.array(z.number().finite()).max(4096).optional(), vectorVersion: z.string().max(400).optional() }) })).max(500) }) }).parse(value);
    const hits = new Map<string, SearchHit>();
    const add = (data: ReturnType<typeof parse>, keyword: boolean) => {
      if (data.timed_out || data._shards?.failed) throw new MatchingProviderError('OPENSEARCH_PARTIAL_RESULTS');
      data.hits.hits.forEach((hit, i) => hits.set(hit._id, { ...hits.get(hit._id), id: hit._id, fingerprint: hit._source.fingerprint,
        ...(keyword ? { keywordRank: i + 1 } : {}), vector: hit._source.embedding, vectorVersion: hit._source.vectorVersion }));
    };
    try {
      add(parse(await this.call('/_search', 'POST', { size, _source: ['fingerprint', 'embedding', 'vectorVersion'],
        query: { bool: { filter: filters, must: terms.length ? [{ multi_match: { query: terms.join(' '), fields: ['title^3', 'skills^3', 'text'], type: 'best_fields', operator: 'or' } }] : [{ match_all: {} }] } },
        sort: [{ _score: 'desc' }, { id: 'asc' }],
      })), true);
      if (vector && this.embeddings) {
        validateVector(vector, this.embeddings.dimensions);
        add(parse(await this.call('/_search', 'POST', { size, _source: ['fingerprint', 'embedding', 'vectorVersion'],
          query: { knn: { embedding: { vector, k: size, filter: { bool: { filter: [...filters, { term: { vectorVersion: this.embeddings.version } }] } } } } },
        })), false);
      }
      return [...hits.values()];
    } catch { throw new MatchingProviderError('OPENSEARCH_RETRIEVAL_FAILED'); }
  }
  async index(job: Job, vector?: number[]) {
    matchingId.parse(job.id);
    if (vector && !this.embeddings) throw new MatchingProviderError('EMBEDDING_UNCONFIGURED');
    await this.call('/_doc/' + encodeURIComponent(job.id), 'PUT', {
      id: job.id, fingerprint: jobFingerprint(job), title: job.title, skills: job.skills, text: jobIndexText(job),
      status: job.status, trust: job.trust, country: job.country, mode: job.mode, discoveredAt: job.discoveredAt, expiresAt: job.expiresAt,
      ...(vector ? { embedding: validateVector(vector, this.embeddings!.dimensions), vectorVersion: this.embeddings!.version } : {}),
    });
  }
  async remove(id: string) { matchingId.parse(id); await this.call('/_doc/' + encodeURIComponent(id), 'DELETE', undefined, true); }
}
let cached: { key: string; config: ProviderConfig; search?: OpenSearchMatchingProvider; embeddings?: EmbeddingProvider } | undefined;
export function configuredMatchingProviders(env = process.env) {
  const config = matchingProviderConfig(env);
  const key = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  if (cached?.key === key) return cached;
  const transport = new MatchingTransport(config.timeoutMs);
  const embeddings = config.embedding ? new HttpEmbeddingProvider(config.embedding, transport) : undefined;
  cached = { key, config, embeddings, search: config.provider === 'opensearch' ? new OpenSearchMatchingProvider(config, transport, embeddings) : undefined };
  return cached;
}
