import { MetadataRoute } from 'next';
import { SEO_CONFIG } from '@/lib/seo-config';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SEO_CONFIG.siteUrl}/sitemap-static.xml`,
      lastModified: new Date(),
    },
    {
      url: `${SEO_CONFIG.siteUrl}/sitemap-blog.xml`,
      lastModified: new Date(),
    },
    {
      url: `${SEO_CONFIG.siteUrl}/sitemap-docs.xml`,
      lastModified: new Date(),
    },
  ];
}
