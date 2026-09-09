// Only the public frontend origin is used here; OAuth credentials stay in Express.
export function googleStartUrl(appUrl?: string) {
  if (!appUrl) return '/api/v1/auth/google';
  const url = new URL(appUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('APP_URL must be the public frontend origin.');
  return new URL('/api/v1/auth/google', url).href;
}
