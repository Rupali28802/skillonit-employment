import assert from 'node:assert/strict';
import test from 'node:test';
import { cvProductionConfig, mapTextkernelResume, parseTextkernelResume } from '../src/lib/cv-production.js';

const common = {
  CV_STORAGE_PROVIDER: 'google-drive', CV_GOOGLE_DRIVE_CLIENT_ID: 'client', CV_GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
  CV_GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh', CV_GOOGLE_DRIVE_FOLDER_ID: 'folder_id_12345', CV_GOOGLE_DRIVE_ACCOUNT: 'cv@example.test',
  CV_SCANNER_PROVIDER: 'cloudmersive', CV_SCANNER_URL: 'https://scanner.example.test', CV_SCANNER_TOKEN: 'scanner', CV_PARSER_VERSION: 'textkernel-v10',
} as const;

const response = {
  Value: { ResumeData: {
    ContactInformation: {
      CandidateName: { FormattedName: 'Alex Candidate' }, EmailAddresses: [{ Address: 'alex@example.test' }],
      Telephones: [{ Normalized: '+15555550100' }], Location: { Municipality: 'Pune', CountryCode: 'IN', Region: 'Maharashtra' },
      WebAddresses: [{ Address: 'https://example.test/alex' }, { Address: 'http://unsafe.example.test' }],
    },
    ProfessionalSummary: 'Backend engineer',
    Skills: { Raw: [{ Name: 'TypeScript' }, { Name: 'PostgreSQL' }], Normalized: [{ Name: 'TypeScript' }] },
    EmploymentHistory: { ExperienceSummary: { MonthsOfWorkExperience: 42 }, Positions: [{ JobTitle: { Raw: 'Engineer' }, Employer: { Name: { Raw: 'Example Ltd' } }, StartDate: { Date: '2022-01-01' }, IsCurrent: true, Description: 'Built reliable services.' }] },
    Education: { EducationDetails: [{ Degree: { Name: { Raw: 'B.Tech' } }, SchoolName: { Raw: 'Example University' }, EndDate: { Date: '2021-06-01' } }] },
    Certifications: [{ Name: 'Cloud Certificate' }], Languages: [{ Language: 'English' }],
  } },
};

test('Textkernel config requires provider-specific credentials without legacy bearer fields', () => {
  const parsed = cvProductionConfig({ ...common, CV_PARSER_PROVIDER: 'textkernel', CV_TEXTKERNEL_ACCOUNT_ID: '47609161', CV_TEXTKERNEL_SERVICE_KEY: 'x'.repeat(40), CV_TEXTKERNEL_REGION: 'eu' });
  assert.equal(parsed.CV_PARSER_PROVIDER, 'textkernel');
  assert.throws(() => cvProductionConfig({ ...common, CV_PARSER_PROVIDER: 'textkernel', CV_TEXTKERNEL_ACCOUNT_ID: 'bad', CV_TEXTKERNEL_SERVICE_KEY: 'short', CV_TEXTKERNEL_REGION: 'eu' }));
});

test('Textkernel response maps only supported candidate profile facts', () => {
  const facts = mapTextkernelResume(response);
  assert.equal(facts.name, 'Alex Candidate'); assert.equal(facts.experience, 3.5);
  assert.deepEqual(facts.skills, ['TypeScript', 'PostgreSQL']);
  assert.equal(facts.employmentHistory?.[0]?.end, 'Present');
  assert.deepEqual(facts.professionalLinks, ['https://example.test/alex']);
  assert.ok(facts.education?.includes('B.Tech')); assert.equal('confirmed' in facts, false);
});

test('Textkernel request uses EU endpoint, credential headers and base64 JSON', async () => {
  let requestUrl = ''; let requestInit: RequestInit | undefined;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => { requestUrl = String(url); requestInit = init; return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
  const facts = await parseTextkernelResume({ accountId: '47609161', serviceKey: 'x'.repeat(40), region: 'eu' }, Buffer.from('synthetic resume'), fakeFetch);
  assert.equal(requestUrl, 'https://api.eu.textkernel.com/tx/v10/parser/resume');
  assert.equal((requestInit?.headers as Record<string, string>)['Tx-AccountId'], '47609161');
  const body = JSON.parse(String(requestInit?.body)); assert.equal(Buffer.from(body.DocumentAsBase64String, 'base64').toString(), 'synthetic resume');
  assert.equal(facts.name, 'Alex Candidate');
});

test('Textkernel adapter fails closed for provider errors and malformed responses', async () => {
  const config = { accountId: '47609161', serviceKey: 'x'.repeat(40), region: 'eu' as const };
  const failed = (async () => new Response('private provider detail', { status: 503 })) as typeof fetch;
  await assert.rejects(parseTextkernelResume(config, Buffer.from('fixture'), failed), { code: 'PARSER_FAILED' });
  const malformed = (async () => Response.json({ Value: { unexpected: true } })) as typeof fetch;
  await assert.rejects(parseTextkernelResume(config, Buffer.from('fixture'), malformed), { code: 'PARSER_FAILED' });
});
