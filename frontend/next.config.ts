import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    // Keep browser cookies and the backend's Origin check on the configured host.
    const origin = process.env.APP_URL;
    if (!origin?.startsWith('https://')) return [];
    const url = new URL(origin);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('APP_URL must be the public frontend origin.');
    return [{
      source: '/:path*', destination: `${url.origin}/:path*`, permanent: false,
      has: [
        { type: 'host' as const, value: '(localhost|127\\.0\\.0\\.1)' },
        { type: 'header' as const, key: 'accept', value: '.*text/html.*' },
      ],
    }];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_URL || 'http://127.0.0.1:4000'}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};
export default config;
