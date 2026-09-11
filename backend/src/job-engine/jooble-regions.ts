// Official regional domains. Credentials remain exclusively in the server environment.
const codes = 'US UA PL CZ RO SK RS HU GR FR FI NO ES PT CH SE DK BE DE AT NL IT GB IE TR BA HR BG KZ IN SG PH PK TH JP TW HK ID KR AZ MY AE SA QA KW BH UZ MX AR CL CO PE DO CR UY SV PR BR CA EC NZ AU NG ZA EG MA'.split(' ');
export const joobleDomains: Record<string, string> = Object.fromEntries(codes.map(code => [code.toLowerCase(),
  code === 'US' ? 'jooble.org' : `${code === 'GB' ? 'uk' : code === 'JP' ? 'ja' : code.toLowerCase()}.jooble.org`]));
export const joobleKey = (country: string) => process.env[`JOOBLE_${country.toUpperCase()}_API_KEY`]?.trim();
