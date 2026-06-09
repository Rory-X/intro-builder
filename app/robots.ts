import { MetadataRoute } from 'next';
import { SEO_CONFIG } from '@/lib/seo-config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/r/*',           // Public resume pages - privacy protection
          '/api/*',         // API routes
          '/resume/*/edit', // Edit pages - require login
          '/dashboard',     // Dashboard - require login
          '/settings',      // Settings - require login
        ],
        crawlDelay: 1,      // Baidu requirement
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/r/*', '/api/*', '/resume/*/edit', '/dashboard', '/settings'],
      },
      {
        userAgent: 'Baiduspider',
        allow: '/',
        disallow: ['/r/*', '/api/*', '/resume/*/edit', '/dashboard', '/settings'],
        crawlDelay: 1,
      },
    ],
    sitemap: `${SEO_CONFIG.siteUrl}/sitemap.xml`,
  };
}
