import isoCountries from 'i18n-iso-countries';
import countryNames from './country-names.json';
// Keep labels and ordering identical during server rendering and hydration.
// Browser and Node ICU versions can return different Intl.DisplayNames values.
export const countryEntries = countryNames;
export const countries = countryEntries.map(c => c.name);
const aliases: Record<string, string> = { UK: 'GB', USA: 'US', UAE: 'AE', 'U.S.': 'US', 'U.S.A.': 'US', 'UNITED STATES OF AMERICA': 'US', 'SOUTH KOREA': 'KR', 'RUSSIA': 'RU', 'VIETNAM': 'VN', 'TURKEY': 'TR' };
export function normalizeCountry(value: string): string | undefined {
 const raw = value.trim(); const upper = raw.toUpperCase();
 const code = aliases[upper] || (upper.length === 3 ? isoCountries.alpha3ToAlpha2(upper) : upper);
 return countryEntries.find(c => c.code === code || c.name.toLowerCase() === raw.toLowerCase())?.name;
}
export function countriesInLocation(value: string): string[] {
 const exact = normalizeCountry(value); if (exact) return [exact];
 // Only explicit names and uppercase standalone codes; do not infer countries from ambiguous cities/regions.
 const result = new Set<string>();
 let remaining = value;
 for (const item of [...countryEntries].sort((a, b) => b.name.length - a.name.length)) { const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); if (new RegExp('(?:^|[^\\p{L}])' + escaped + '(?=$|[^\\p{L}])', 'iu').test(remaining)) { result.add(item.name); remaining = remaining.replaceAll(new RegExp(escaped, 'giu'), ' '); } }
 for (const part of value.split(/[,;/|()]+/)) { const found = normalizeCountry(part); if (found) result.add(found); }
 for (const token of value.match(/\b(?:USA|UAE|UK|US|GB|AU|IN)\b/g) || []) { const found = normalizeCountry(token); if (found) result.add(found); }
 return [...result];
}
