import { PDFDocument, StandardFonts } from 'pdf-lib';

const accountId = process.env.CV_TEXTKERNEL_ACCOUNT_ID;
const serviceKey = process.env.CV_TEXTKERNEL_SERVICE_KEY;
const region = process.env.CV_TEXTKERNEL_REGION || 'eu';
if (!/^\d{1,20}$/.test(accountId || '') || !serviceKey || !['eu', 'us', 'au'].includes(region)) {
  console.error('Textkernel provider configuration is missing or invalid.'); process.exit(1);
}
const pdf = await PDFDocument.create();
const page = pdf.addPage([612, 792]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const lines = ['ALEX VALIDATION', 'Backend Engineer', 'alex.validation@example.test | Pune, India', 'SUMMARY', 'Backend engineer building reliable systems.', 'SKILLS', 'TypeScript, PostgreSQL, Node.js, REST APIs', 'EXPERIENCE', 'Backend Engineer, Example Validation Ltd, January 2022 - Present', 'Built reliable services and PostgreSQL applications.', 'EDUCATION', 'B.Tech Computer Science, Example University, 2021'];
lines.forEach((line, index) => page.drawText(line, { x: 55, y: 740 - index * 32, size: index === 0 ? 18 : 11, font }));
const bytes = await pdf.save();
const response = await fetch(`https://api.${region}.textkernel.com/tx/v10/parser/resume`, {
  method: 'POST', headers: { 'Tx-AccountId': accountId, 'Tx-ServiceKey': serviceKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ DocumentAsBase64String: Buffer.from(bytes).toString('base64'), DocumentLastModified: new Date().toISOString().slice(0, 10), SkillsSettings: { Normalize: false } }),
});
let payload = {}; try { payload = await response.json(); } catch {}
const data = payload?.Value?.ResumeData || {};
const result = { httpStatus: response.status, success: response.ok, hasResumeData: Boolean(payload?.Value?.ResumeData), syntheticNameMatched: /alex/i.test(data?.ContactInformation?.CandidateName?.FormattedName || ''), rawSkillCount: (data?.Skills?.Raw || []).length, hasEmployment: Array.isArray(data?.EmploymentHistory?.Positions) && data.EmploymentHistory.Positions.length > 0, errorCode: payload?.Info?.Code || null, errorMessage: response.ok ? null : String(payload?.Info?.Message || 'Provider rejected the request').slice(0, 300) };
console.log(JSON.stringify(result));
if (!result.success || !result.hasResumeData) process.exitCode = 1;
