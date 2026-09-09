import type { Profile } from './domain.js';
import { productionCvProviders } from './cv-production.js';

/** Storage implementations must use private objects, encryption and bounded reads. */
export interface CvObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
export interface CvScanner { scan(bytes: Uint8Array, contentType: string): Promise<'clean' | 'rejected'> }
/** Extract only facts explicitly supported by source text; omit unknowns (never infer zero experience). Reject unsupported enrichment. Provider results are untrusted drafts; never write canonical profiles here. */
export interface CvParser { version?: string; extract(bytes: Uint8Array, contentType: string): Promise<Partial<Profile>> }
export type CvProviders = { storage: CvObjectStorage; scanner: CvScanner; parser: CvParser };

// Wire audited deployment adapters here. Never enable test adapters by environment flag.
export function configuredCvProviders(): CvProviders | undefined {
  if (process.env.ENABLE_CV_UPLOADS !== 'true') return undefined;
  try { return productionCvProviders(); } catch { return undefined; }
}
