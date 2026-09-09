import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { bounded } from './module2-config.js';
import type { CvProviders } from './cv-providers.js';

type Result = 'PASS' | 'FAIL' | 'NOT_RUN';
export type ProviderReport = Record<'storagePolicy' | 'storageRoundTrip' | 'cleanDocumentScan' | 'parserResponse' | 'cleanupRequest', Result>;

/** Explicit live probe: generated non-personal PDF only; no users, sessions or database access. */
export async function validateCvProviders(providers: CvProviders & { check(): Promise<void> }): Promise<ProviderReport> {
  const report: ProviderReport = { storagePolicy: 'NOT_RUN', storageRoundTrip: 'NOT_RUN', cleanDocumentScan: 'NOT_RUN', parserResponse: 'NOT_RUN', cleanupRequest: 'NOT_RUN' };
  try { await bounded(providers.check(), 'STORAGE_POLICY_FAILED'); report.storagePolicy = 'PASS'; }
  catch { report.storagePolicy = 'FAIL'; return report; }
  const document = await PDFDocument.create();
  const page = document.addPage();
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Module 2 provider validation fixture. No candidate information.', { x: 40, y: 740, size: 12, font });
  const bytes = await document.save();
  const key = 'cv/validation/' + randomUUID();
  try {
    // Cleanup is attempted even when a timed-out write may have reached storage.
    await bounded(providers.storage.put(key, bytes, 'application/pdf'), 'STORAGE_FAILED');
    const returned = await bounded(providers.storage.get(key), 'STORAGE_FAILED');
    if (!Buffer.from(bytes).equals(Buffer.from(returned))) throw new Error();
    report.storageRoundTrip = 'PASS';
    try {
      if (await bounded(providers.scanner.scan(bytes, 'application/pdf'), 'SCANNER_FAILED') !== 'clean') throw new Error();
      report.cleanDocumentScan = 'PASS';
    } catch { report.cleanDocumentScan = 'FAIL'; return report; }
    try {
      await bounded(providers.parser.extract(bytes, 'application/pdf'), 'PARSER_FAILED');
      report.parserResponse = 'PASS';
    } catch { report.parserResponse = 'FAIL'; }
  } catch { report.storageRoundTrip = 'FAIL'; }
  finally {
    try { await bounded(providers.storage.delete(key), 'STORAGE_DELETE_FAILED'); report.cleanupRequest = 'PASS'; }
    catch { report.cleanupRequest = 'FAIL'; }
  }
  return report;
}
