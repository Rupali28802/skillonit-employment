export function jobReturnPath(value: unknown): string | null {
  return typeof value === 'string' && /^\/jobs\/[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;
}

export function authReturnPath(value: string | null): string | null {
  return value === '/connect-email' ? value : jobReturnPath(value);
}
