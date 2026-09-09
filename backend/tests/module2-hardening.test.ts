import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { validateCvStructure } from '../src/lib/cv-file-validation.js';
import { bounded, module2Config } from '../src/lib/module2-config.js';
import { productionCvProviders, cvProductionConfig } from '../src/lib/cv-production.js';
import type { S3Client } from '@aws-sdk/client-s3';
import { ZipFile } from 'yazl';
import { app } from '../src/app.js';
import { closeStore } from '../src/lib/store.js';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
async function docxFixture(external = false) {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), '[Content_Types].xml');
  zip.addBuffer(Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"' + (external ? ' TargetMode="External"' : '') + '/></Relationships>'), '_rels/.rels');
  zip.addBuffer(Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Test fixture</w:t></w:r></w:p></w:body></w:document>'), 'word/document.xml');
  const result = new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; zip.outputStream.on('data', b => chunks.push(b)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); });
  zip.end(); return result;
}

test('CV document validation rejects malformed/encrypted-format input without logging content', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  await validateCvStructure(await pdf.save(), 'application/pdf');
  await assert.rejects(validateCvStructure(Buffer.from('%PDF-1.7\nnot a real PDF'), 'application/pdf'), { code: 'CV_MALFORMED' });
  await assert.rejects(validateCvStructure(Buffer.from('PK\x03\x04not a DOCX'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), { code: 'CV_MALFORMED' });
  await validateCvStructure(await docxFixture(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await assert.rejects(validateCvStructure(await docxFixture(true), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), { code: 'CV_MALFORMED' });
});
test('CV validation closes the worker before its temporary working directory is removed', async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(tmpdir(), 'skillonit-cv-close-'));
  try {
    process.chdir(dir);
    const pdf = await PDFDocument.create(); pdf.addPage();
    await validateCvStructure(await pdf.save(), 'application/pdf');
    await assert.rejects(validateCvStructure(Buffer.from('invalid PDF'), 'application/pdf'), { code: 'CV_MALFORMED' });
  } finally {
    process.chdir(cwd);
    if (path.dirname(dir) === path.resolve(tmpdir()) && path.basename(dir).startsWith('skillonit-cv-close-')) await rm(dir, { recursive: true, force: true });
  }
});
test('CV configuration and timeout fail closed with sanitized failures', async () => {
  assert.throws(() => cvProductionConfig({}));
  const env = { ...process.env };
  try {
    process.env.CV_MAX_BYTES = '-1'; assert.throws(module2Config); delete process.env.CV_MAX_BYTES;
    process.env.CV_PROVIDER_TIMEOUT_MS = '10';
    await assert.rejects(bounded(new Promise(() => {}), 'SCANNER_FAILED'), { code: 'SCANNER_FAILED' });
    await assert.rejects(bounded(Promise.reject(new Error('sensitive provider fixture')), 'PARSER_FAILED'), error => error instanceof Error && !error.message.includes('sensitive'));
  } finally { process.env = env; }
});
test('Production adapter contracts: encryption, private policy, safe keys, scanner/parser errors (test doubles, not live providers)', async () => {
  const env = { ...process.env }, originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, { CV_STORAGE_PROVIDER: 's3', CV_S3_BUCKET: 'fixture-bucket', CV_S3_REGION: 'us-east-1', CV_SCANNER_PROVIDER: 'https', CV_SCANNER_URL: 'https://scanner.example.test/scan', CV_SCANNER_TOKEN: 'unit-fixture', CV_PARSER_PROVIDER: 'https', CV_PARSER_URL: 'https://parser.example.test/parse', CV_PARSER_TOKEN: 'unit-fixture', CV_PARSER_VERSION: 'v1' });
    let privateBucket = true, versioned = false;
    const commands: { name: string; input: Record<string, unknown> }[] = [];
    const fakeClient = { async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      commands.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === 'GetPublicAccessBlockCommand') return { PublicAccessBlockConfiguration: { BlockPublicAcls: privateBucket, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } };
      if (command.constructor.name === 'GetBucketVersioningCommand') return { Status: versioned ? 'Enabled' : undefined };
      if (command.constructor.name === 'GetObjectCommand') return { ContentLength: 2, Body: (async function* () { yield Buffer.from('ok'); })() };
      return {};
    } } as unknown as S3Client;
    const providers = productionCvProviders(fakeClient);
    await providers.check(); privateBucket = false; await assert.rejects(providers.check()); privateBucket = true; versioned = true; await assert.rejects(providers.check()); versioned = false;
    await providers.storage.put('cv/user/document', Buffer.from('ok'), 'application/pdf');
    assert.equal(commands.find(c => c.name === 'PutObjectCommand')?.input.ServerSideEncryption, 'AES256');
    await assert.rejects(providers.storage.get('../secret'), { code: 'STORAGE_FAILED' });
    assert.equal(Buffer.from(await providers.storage.get('cv/user/document')).toString(), 'ok');
    await providers.storage.delete('cv/user/document');
    globalThis.fetch = async (_url, options) => { assert.equal(options?.redirect, 'error'); return Response.json({ status: 'CLEAN' }); };
    assert.equal(await providers.scanner.scan(Buffer.from('fixture'), 'application/pdf'), 'clean');
    globalThis.fetch = async () => Response.json({ status: 'INFECTED' });
    assert.equal(await providers.scanner.scan(Buffer.from('fixture'), 'application/pdf'), 'rejected');
    globalThis.fetch = async () => Response.json({ version: 'v1', facts: { skills: ['Supplied fixture skill'] } });
    assert.deepEqual(await providers.parser.extract(Buffer.from('fixture'), 'application/pdf'), { skills: ['Supplied fixture skill'] });
    globalThis.fetch = async () => new Response('private error fixture', { status: 500 });
    await assert.rejects(providers.scanner.scan(Buffer.from('fixture'), 'application/pdf'), { code: 'SCANNER_FAILED' });
    await assert.rejects(providers.parser.extract(Buffer.from('fixture'), 'application/pdf'), { code: 'PARSER_FAILED' });
  } finally { process.env = env; globalThis.fetch = originalFetch; }
});
test('MongoDB unavailable returns a classified error without driver details', async () => {
  const env = { ...process.env }; await closeStore();
  Object.assign(process.env, { MONGODB_URI: 'mongodb://127.0.0.1:1', MONGODB_DATABASE: 'architecture_test', DEMO_MODE: 'false', APP_URL: 'http://localhost:3000' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/session`, { headers: { Cookie: 'skillonit_session=nonsecret-outage-fixture' } });
    assert.equal(response.status, 503); const body = await response.json();
    assert.equal(body.error.classification, 'dependency');
    assert.ok(!JSON.stringify(body).includes('mongodb://')); assert.ok(!JSON.stringify(body).includes('MongoServerSelectionError'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await closeStore(); process.env = env; }
});
