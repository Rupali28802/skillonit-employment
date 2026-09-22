// Only the public frontend origin is used here; OAuth credentials stay in Express.
export function googleStartUrl(appUrl?: string) {
  if (!appUrl) return '/api/v1/auth/google';
  const url = new URL(appUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('APP_URL must be the public frontend origin.');
  return new URL('/api/v1/auth/google', url).href;
}

export const WHATSAPP_SUPPORT_MESSAGE = 'Hello SkillOnIT Support, I need help with my account.';

export function whatsappSupportUrl(phoneNumber = process.env.NEXT_PUBLIC_WHATSAPP_SUPPORT_NUMBER) {
  const number = phoneNumber?.trim();
  if (!number) return null;

  // wa.me expects an international number containing digits only, without a leading +.
  if (!/^[1-9]\d{7,14}$/.test(number)) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(WHATSAPP_SUPPORT_MESSAGE)}`;
}
