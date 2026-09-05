import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, CookieOptions } from 'express';

export const requestContext = new AsyncLocalStorage<{
  request: Request;
  response: Response;
}>();

// Request-local session transport. Authentication and storage stay in the backend.
export function cookies() {
  const context = requestContext.getStore();
  if (!context) throw new Error('Session access requires an HTTP request.');
  return {
    get(name: string) {
      const value = context.request.headers.cookie
        ?.split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith(name + '='))
        ?.slice(name.length + 1);
      return value ? { value: decodeURIComponent(value) } : undefined;
    },
    set(name: string, value: string, options: CookieOptions) {
      context.response.cookie(name, value, options);
    },
    delete(name: string) {
      context.response.clearCookie(name, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    },
  };
}
