import type { MetadataRoute } from 'next';
export default function sitemap(): MetadataRoute.Sitemap {
  if (!process.env.APP_URL || process.env.DEMO_MODE === 'true') return [];
  return ['', '/about', '/trust', '/contact', '/pricing'].map((p) => ({
    url: process.env.APP_URL + p,
  }));
}
