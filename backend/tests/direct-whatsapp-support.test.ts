import assert from 'node:assert/strict';
import test from 'node:test';

import { handle } from '../src/api.ts';
import {
  parseWhatsAppSupportPhone,
  publicWhatsAppSupportConfig,
  whatsappClickToChatUrl,
  WHATSAPP_SUPPORT_MESSAGE,
} from '../src/lib/direct-whatsapp-support.ts';

test('direct WhatsApp support configuration is validated and fail-closed', () => {
  const configured = publicWhatsAppSupportConfig({ WHATSAPP_SUPPORT_PHONE: '919876543210' } as NodeJS.ProcessEnv);
  assert.deepEqual(configured, {
    whatsapp: { enabled: true, phone: '919876543210', message: WHATSAPP_SUPPORT_MESSAGE },
  });
  assert.deepEqual(publicWhatsAppSupportConfig({} as NodeJS.ProcessEnv), {
    whatsapp: { enabled: false, phone: null, message: WHATSAPP_SUPPORT_MESSAGE },
  });
  assert.deepEqual(publicWhatsAppSupportConfig({ WHATSAPP_SUPPORT_PHONE: '+91 98765-43210' } as NodeJS.ProcessEnv), {
    whatsapp: { enabled: false, phone: null, message: WHATSAPP_SUPPORT_MESSAGE },
  });
  assert.throws(() => parseWhatsAppSupportPhone('+91 98765-43210'));
});

test('click-to-chat URL validates the phone and URL-encodes the approved message', () => {
  assert.equal(
    whatsappClickToChatUrl('919876543210'),
    `https://wa.me/919876543210?text=${encodeURIComponent(WHATSAPP_SUPPORT_MESSAGE)}`,
  );
  assert.throws(() => whatsappClickToChatUrl('not-a-phone'));
});

test('public support endpoint cannot be overridden and exposes no credentials', async () => {
  const saved = { ...process.env };
  try {
    process.env.DEMO_MODE = 'true';
    process.env.APP_URL = 'http://localhost:3000';
    process.env.WHATSAPP_SUPPORT_PHONE = '919876543210';
    process.env.GOOGLE_CLIENT_SECRET = 'must-not-leak';
    const response = await handle(
      new Request('http://localhost:4000/api/v1/support/config?phone=441234567890', {
        headers: { Origin: process.env.APP_URL },
      }),
      { params: Promise.resolve({ path: ['support', 'config'] }) },
    );
    assert.equal(response.status, 200);
    const payload = await response.json() as { data: { whatsapp: { phone: string } } };
    assert.equal(payload.data.whatsapp.phone, '919876543210');
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /441234567890|must-not-leak|secret|token|authorization/i);
  } finally {
    process.env = saved;
  }
});
