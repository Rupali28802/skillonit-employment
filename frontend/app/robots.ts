import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow:
        process.env.DEMO_MODE === 'true'
          ? '/'
          : [
              '/api/',
              '/admin',
              '/dashboard',
              '/profile',
              '/applications',
              '/employer/',
              '/login',
              '/register',
              '/verify-email',
              '/forgot-password',
              '/reset-password',
              '/*?*q=',
              '/*?*sort=',
              '/*?*filter=',
              '/*?*page=',
            ],
    },
    sitemap: process.env.APP_URL
      ? process.env.APP_URL + '/sitemap.xml'
      : undefined,
  };
}
