// Signals are reasons for review, never proof of a legitimate employer.
export function assessRisk(description: string, applyUrl: string) {
  const reasons: string[] = [];
  if (/\b(pay|send|transfer)\b.{0,60}\b(fee|deposit|password|otp)\b|registration fee/i.test(description)) reasons.push('payment_or_secret_request');
  if (/\b(bitcoin|crypto|gift card)\b.{0,60}\b(deposit|payment|send|purchase)\b|\b(deposit|pay)\b.{0,60}\b(bitcoin|crypto|gift card)\b/i.test(description)) reasons.push('unusual_payment');
  if (/\b(share|send|provide)\b.{0,40}\b(otp|password|bank login|verification code)\b/i.test(description)) reasons.push('credential_request');
  const host = new URL(applyUrl).hostname.toLowerCase();
  if (host.split('.').some(part => part.startsWith('xn--'))) reasons.push('internationalized_domain_review');
  if (['bit.ly','tinyurl.com','t.co','shorturl.at'].includes(host)) reasons.push('shortened_application_link');
  return { reasons, assessedAt: new Date().toISOString(), method: 'rules-v1' as const };
}
