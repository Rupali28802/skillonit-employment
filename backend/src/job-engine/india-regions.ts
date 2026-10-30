// Canonical state and union-territory names used only for coverage measurement.
// Source-provided state text remains unchanged on the job record.
export const indiaRegions = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;

const aliases: Record<string, (typeof indiaRegions)[number]> = {
  'andaman & nicobar islands': 'Andaman and Nicobar Islands',
  'nct of delhi': 'Delhi', 'new delhi': 'Delhi',
  'orissa': 'Odisha', 'pondicherry': 'Puducherry', 'uttaranchal': 'Uttarakhand',
  'jammu & kashmir': 'Jammu and Kashmir',
};
const regions = new Map(indiaRegions.map(region => [region.toLowerCase(), region]));

export function indiaRegion(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  return regions.get(normalized) || aliases[normalized];
}
