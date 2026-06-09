import { MetadataRoute } from 'next';
import { SEO_CONFIG } from '@/lib/seo-config';
import { blogSource } from '@/lib/source';

export default function sitemapBlog(): MetadataRoute.Sitemap {
  const posts = blogSource.getPages().filter(p => !p.data.draft);

  return posts.map(post => ({
    url: `${SEO_CONFIG.siteUrl}${post.url}`,
    lastModified: post.data.date ? new Date(post.data.date) : new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));
}
