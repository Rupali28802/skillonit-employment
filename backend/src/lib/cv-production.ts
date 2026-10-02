import { z } from 'zod';
import { profileSchema } from './schemas.js';
import type { CvProviders } from './cv-providers.js';
import { module2Config, CvProviderError } from './module2-config.js';
import { googleDriveStorage } from './google-drive-storage.js';

const https = z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; });
export function cvProductionConfig(env = process.env) {
  const common = z.object({ CV_STORAGE_PROVIDER: z.literal('google-drive'), CV_GOOGLE_DRIVE_CLIENT_ID: z.string().min(1), CV_GOOGLE_DRIVE_CLIENT_SECRET: z.string().min(1), CV_GOOGLE_DRIVE_REFRESH_TOKEN: z.string().min(1), CV_GOOGLE_DRIVE_FOLDER_ID: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/), CV_GOOGLE_DRIVE_ACCOUNT: z.email().toLowerCase(), CV_SCANNER_PROVIDER: z.literal('cloudmersive'), CV_SCANNER_URL: https, CV_SCANNER_TOKEN: z.string().min(1), CV_PARSER_VERSION: z.string().min(1).max(100) });
  const parser = z.discriminatedUnion('CV_PARSER_PROVIDER', [
    z.object({ CV_PARSER_PROVIDER: z.literal('https'), CV_PARSER_URL: https, CV_PARSER_TOKEN: z.string().min(1) }),
    z.object({ CV_PARSER_PROVIDER: z.literal('textkernel'), CV_TEXTKERNEL_ACCOUNT_ID: z.string().regex(/^\d{1,20}$/), CV_TEXTKERNEL_SERVICE_KEY: z.string().min(20).max(200), CV_TEXTKERNEL_REGION: z.enum(['eu', 'us', 'au']).default('eu') }),
  ]);
  return common.and(parser).parse(env);
}
async function jsonService(url: string, token: string, bytes: Uint8Array, contentType: string, operation: string, fetchFn: typeof fetch = fetch) {
  try {
    const response = await fetchFn(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': contentType }, body: Buffer.from(bytes), redirect: 'error', signal: AbortSignal.timeout(module2Config().CV_PROVIDER_TIMEOUT_MS) });
    if (!response.ok || !response.body) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 131072) { await response.body.cancel().catch(() => {}); throw new Error(); } chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch { throw new CvProviderError(operation + '_FAILED'); }
}
async function cloudmersiveScan(url: string, token: string, bytes: Uint8Array, contentType: string, fetchFn: typeof fetch = fetch) {
  try {
    const form = new FormData();
    form.set('inputFile', new Blob([Buffer.from(bytes)], { type: contentType }), contentType === 'application/pdf' ? 'candidate.pdf' : 'candidate.docx');
    const response = await fetchFn(url, { method: 'POST', headers: { Apikey: token }, body: form, redirect: 'error', signal: AbortSignal.timeout(module2Config().CV_PROVIDER_TIMEOUT_MS) });
    if (!response.ok) throw new Error();
    const result = z.object({ CleanResult: z.boolean() }).passthrough().parse(await response.json());
    return result.CleanResult ? 'clean' as const : 'rejected' as const;
  } catch { throw new CvProviderError('SCANNER_FAILED'); }
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, max = 3000): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const path = (value: unknown, ...keys: string[]): unknown => keys.reduce((current, key) => record(current)[key], value);
const first = (...values: unknown[]): string => values.map(value => string(value)).find(Boolean) || '';
const unique = (values: string[], max = 50): string[] => [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, max);
const date = (value: unknown): string => {
  const raw = first(path(value, 'Date'), path(value, 'Value'), value);
  const match = raw.match(/^(\d{4})(?:-(\d{2}))?/);
  return match ? match[1] + (match[2] ? '-' + match[2] : '') : '';
};

/** Convert Textkernel's ResumeData into candidate-owned, reviewable profile facts. */
export function mapTextkernelResume(payload: unknown) {
  const resume = record(path(payload, 'Value', 'ResumeData'));
  const contact = record(resume.ContactInformation);
  const location = record(contact.Location);
  const positions = array(path(resume, 'EmploymentHistory', 'Positions'));
  const employmentHistory = positions.map(value => {
    const row = record(value);
    const current = row.IsCurrent === true || /current|present/i.test(first(path(row, 'EndDate', 'FoundYear'), path(row, 'EndDate', 'Date')));
    return {
      title: first(path(row, 'JobTitle', 'Normalized'), path(row, 'JobTitle', 'Raw'), row.JobTitle).slice(0, 200),
      employer: first(path(row, 'Employer', 'Name', 'Normalized'), path(row, 'Employer', 'Name', 'Raw'), path(row, 'Employer', 'Name'), row.Employer).slice(0, 200),
      start: date(row.StartDate),
      end: current ? 'Present' : date(row.EndDate),
      description: first(row.Description, path(row, 'Description', 'PlainText'), row.Bullets).slice(0, 3000),
    };
  }).filter(row => row.title || row.employer).slice(0, 30);
  const rawSkills = array(path(resume, 'Skills', 'Raw')).map(value => first(path(value, 'Name'), value));
  const normalizedSkills = array(path(resume, 'Skills', 'Normalized')).map(value => first(path(value, 'Name'), value));
  const education = array(path(resume, 'Education', 'EducationDetails')).map(value => {
    const row = record(value);
    return [first(path(row, 'Degree', 'Name', 'Normalized'), path(row, 'Degree', 'Name', 'Raw'), path(row, 'Degree', 'Name')), first(path(row, 'SchoolName', 'Normalized'), path(row, 'SchoolName', 'Raw'), row.SchoolName), date(row.EndDate)].filter(Boolean).join(', ');
  }).filter(Boolean).join('\n').slice(0, 3000);
  const emails = array(contact.EmailAddresses).map(value => first(path(value, 'Address'), value));
  const phones = array(contact.Telephones).map(value => first(path(value, 'Normalized'), path(value, 'Raw'), value));
  const links = unique(array(contact.WebAddresses).map(value => first(path(value, 'Address'), value)).filter(value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } }), 20);
  const certifications = unique(array(resume.Certifications).map(value => first(path(value, 'Name'), value)));
  const languages = unique(array(resume.Languages).map(value => first(path(value, 'Language'), path(value, 'Name'), value)));
  const years = Number(path(resume, 'EmploymentHistory', 'ExperienceSummary', 'MonthsOfWorkExperience')) / 12;
  return profileSchema.partial().omit({ confirmed: true }).strict().parse({
    name: first(path(contact, 'CandidateName', 'FormattedName'), path(contact, 'CandidateName', 'FullName')).slice(0, 200),
    headline: first(resume.ProfessionalSummary, path(resume, 'EmploymentHistory', 'ExperienceSummary', 'CurrentManagementLevel')).slice(0, 200),
    skills: unique([...normalizedSkills, ...rawSkills]),
    experience: Number.isFinite(years) ? Math.min(70, Math.max(0, Math.round(years * 10) / 10)) : null,
    education,
    country: first(path(location, 'CountryCode'), path(location, 'Country')).slice(0, 200),
    city: first(path(location, 'Municipality'), path(location, 'City')).slice(0, 200),
    employmentHistory,
    contactInfo: unique([...emails, ...phones], 20).join(' · ').slice(0, 500),
    region: first(path(location, 'Regions', '0'), path(location, 'Region')).slice(0, 200),
    certifications,
    professionalLinks: links,
    languages,
  });
}

export async function parseTextkernelResume(config: { accountId: string; serviceKey: string; region: 'eu' | 'us' | 'au' }, bytes: Uint8Array, fetchFn: typeof fetch = fetch) {
  try {
    const response = await fetchFn(`https://api.${config.region}.textkernel.com/tx/v10/parser/resume`, {
      method: 'POST', headers: { 'Tx-AccountId': config.accountId, 'Tx-ServiceKey': config.serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ DocumentAsBase64String: Buffer.from(bytes).toString('base64'), DocumentLastModified: new Date().toISOString().slice(0, 10), SkillsSettings: { Normalize: false } }),
      redirect: 'error', signal: AbortSignal.timeout(module2Config().CV_PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error();
    const facts = mapTextkernelResume(await response.json());
    const hasResumeData = Object.values(facts).some(value =>
      typeof value === 'number' ? Number.isFinite(value) :
      typeof value === 'string' ? value.trim().length > 0 :
      Array.isArray(value) ? value.length > 0 :
      value !== null && value !== undefined,
    );
    if (!hasResumeData) throw new Error();
    return facts;
  } catch { throw new CvProviderError('PARSER_FAILED'); }
}
/** Private Google Drive storage plus the existing HTTPS scanner/parser adapters. */
export function productionCvProviders(fetchOverride?: typeof fetch): CvProviders & { check(): Promise<void> } {
  const config = cvProductionConfig();
  const storage = googleDriveStorage({ clientId: config.CV_GOOGLE_DRIVE_CLIENT_ID, clientSecret: config.CV_GOOGLE_DRIVE_CLIENT_SECRET, refreshToken: config.CV_GOOGLE_DRIVE_REFRESH_TOKEN, folderId: config.CV_GOOGLE_DRIVE_FOLDER_ID, account: config.CV_GOOGLE_DRIVE_ACCOUNT }, fetchOverride);
  return {
    check: storage.check,
    storage,
    scanner: { async scan(bytes, contentType) { return cloudmersiveScan(config.CV_SCANNER_URL, config.CV_SCANNER_TOKEN, bytes, contentType); } },
    parser: { version: config.CV_PARSER_VERSION, async extract(bytes, contentType) {
      if (config.CV_PARSER_PROVIDER === 'textkernel') return parseTextkernelResume({ accountId: config.CV_TEXTKERNEL_ACCOUNT_ID, serviceKey: config.CV_TEXTKERNEL_SERVICE_KEY, region: config.CV_TEXTKERNEL_REGION }, bytes);
      const result = z.object({ version: z.literal(config.CV_PARSER_VERSION), facts: profileSchema.partial().omit({ confirmed: true }).strict() }).strict().parse(await jsonService(config.CV_PARSER_URL, config.CV_PARSER_TOKEN, bytes, contentType, 'PARSER'));
      return result.facts;
    } },
  };
}
