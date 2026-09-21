export function isTrustedAppOrigin(url: URL, environment = process.env.NODE_ENV) {
  if (url.protocol === 'https:') return true;
  return environment !== 'production' &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}
