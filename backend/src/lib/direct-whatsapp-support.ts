import { z } from 'zod';

export const WHATSAPP_SUPPORT_MESSAGE = 'Hello SkillOnIT Support, I need help with my account.';

const internationalPhone = z.string().trim().regex(
  /^[1-9]\d{7,14}$/,
  'WHATSAPP_SUPPORT_PHONE must use 8 to 15 international digits without +, spaces or punctuation.',
);

export function parseWhatsAppSupportPhone(value: unknown) {
  return internationalPhone.parse(value);
}

export function whatsappClickToChatUrl(phone: string, message = WHATSAPP_SUPPORT_MESSAGE) {
  const normalizedPhone = parseWhatsAppSupportPhone(phone);
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

export function publicWhatsAppSupportConfig(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.WHATSAPP_SUPPORT_PHONE?.trim();
  if (!configured) {
    return { whatsapp: { enabled: false, phone: null, message: WHATSAPP_SUPPORT_MESSAGE } };
  }

  const parsed = internationalPhone.safeParse(configured);
  if (!parsed.success) {
    return { whatsapp: { enabled: false, phone: null, message: WHATSAPP_SUPPORT_MESSAGE } };
  }

  return { whatsapp: { enabled: true, phone: parsed.data, message: WHATSAPP_SUPPORT_MESSAGE } };
}
