'use client';

import { useEffect, useState } from 'react';
import { WHATSAPP_SUPPORT_MESSAGE, whatsappSupportUrl } from '@/lib/frontend-config';

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M16.04 3.2A12.72 12.72 0 0 0 5.3 22.74L3.2 28.8l6.25-2.02a12.76 12.76 0 1 0 6.59-23.58Zm0 22.98a10.55 10.55 0 0 1-5.37-1.47l-.38-.23-3.71 1.2 1.22-3.61-.25-.38a10.53 10.53 0 1 1 8.49 4.49Zm5.78-7.88c-.32-.16-1.87-.92-2.16-1.03-.29-.11-.5-.16-.71.16-.21.32-.82 1.03-1 1.24-.19.21-.37.24-.69.08-.32-.16-1.34-.49-2.55-1.58a9.57 9.57 0 0 1-1.77-2.2c-.19-.32-.02-.49.14-.65.14-.14.32-.37.47-.55.16-.19.21-.32.32-.53.1-.21.05-.4-.03-.55-.08-.16-.71-1.71-.97-2.34-.26-.62-.52-.54-.71-.55h-.61c-.21 0-.55.08-.84.4-.29.32-1.11 1.08-1.11 2.64s1.13 3.06 1.29 3.27c.16.21 2.23 3.41 5.4 4.78.75.32 1.34.52 1.8.67.76.24 1.45.21 1.99.13.61-.09 1.87-.77 2.14-1.5.26-.74.26-1.37.18-1.5-.08-.13-.29-.21-.61-.37Z"
      />
    </svg>
  );
}

export function WhatsAppSupport() {
  const [href, setHref] = useState<string | null>();

  useEffect(() => {
    const controller = new AbortController();

    async function loadConfiguration() {
      try {
        const response = await fetch('/api/v1/support/config', {
          cache: 'no-store',
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Support configuration is unavailable.');

        const payload = (await response.json()) as {
          data?: { whatsapp?: { enabled?: boolean; phone?: string; message?: string } };
        };
        const whatsapp = payload.data?.whatsapp;
        if (!whatsapp?.enabled || whatsapp.message !== WHATSAPP_SUPPORT_MESSAGE) {
          setHref(null);
          return;
        }

        setHref(whatsappSupportUrl(whatsapp.phone));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setHref(null);
      }
    }

    void loadConfiguration();
    return () => controller.abort();
  }, []);

  if (!href) {
    return (
      <button
        type="button"
        className="whatsapp-support is-unavailable"
        aria-label={href === undefined ? 'Loading WhatsApp Support' : 'WhatsApp Support is not configured'}
        title="WhatsApp Support"
        disabled
      >
        <WhatsAppIcon />
        <span>WhatsApp</span>
      </button>
    );
  }

  return (
    <a
      className="whatsapp-support"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Contact SkillOnIT Support on WhatsApp"
      title="WhatsApp Support"
    >
      <WhatsAppIcon />
      <span>WhatsApp</span>
    </a>
  );
}
