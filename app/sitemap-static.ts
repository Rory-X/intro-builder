import { MetadataRoute } from 'next';
import { SEO_CONFIG } from '@/lib/seo-config';

export default function sitemapStatic(): MetadataRoute.Sitemap {
  const staticPages = [
    { url: '', changeFrequency: 'weekly' as const, priority: 1.0 },          // Home
    { url: '/login', changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: '/terms', changeFrequency: 'yearly' as const, priority: 0.3 },
  ];

  return staticPages.map(page => ({
    url: `${SEO_CONFIG.siteUrl}${page.url}`,
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
