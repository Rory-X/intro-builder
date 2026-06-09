import { MetadataRoute } from 'next';
import { SEO_CONFIG } from '@/lib/seo-config';
import { docsSource } from '@/lib/source';

export default function sitemapDocs(): MetadataRoute.Sitemap {
  const pages = docsSource.getPages();

  return pages.map(page => ({
    url: `${SEO_CONFIG.siteUrl}${page.url}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));
}
