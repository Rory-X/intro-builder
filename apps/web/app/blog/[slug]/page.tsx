import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { blogSource } from "@/lib/source";
import { SEO_CONFIG } from "@/lib/seo-config";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function BlogPost({ params }: PageProps) {
  const { slug } = await params;
  const post = blogSource.getPage([slug]);

  if (!post || post.data.draft) notFound();

  const Mdx = post.data.body;

  return (
    <article>
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{post.data.title}</h1>
        {post.data.description && (
          <p className="text-lg text-muted-foreground mt-2">{post.data.description}</p>
        )}
        <div className="flex items-center gap-3 mt-4 text-sm text-muted-foreground">
          {post.data.date && (
            <time dateTime={new Date(post.data.date).toISOString()}>
              {new Date(post.data.date).toLocaleDateString("zh-CN")}
            </time>
          )}
          <span>· {post.data.author}</span>
        </div>
      </header>
      <div className="prose prose-neutral dark:prose-invert max-w-none">
        <Mdx />
      </div>
    </article>
  );
}

export function generateStaticParams() {
  return blogSource.generateParams().map((params) => ({
    slug: params.slug.join("/"),
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = blogSource.getPage([slug]);

  if (!post || post.data.draft) return {};

  const url = `${SEO_CONFIG.siteUrl}${post.url}`;

  return {
    title: post.data.title,
    description: post.data.description,
    keywords: post.data.tags,
    openGraph: {
      title: post.data.title,
      description: post.data.description,
      url,
      type: 'article',
      publishedTime: post.data.date?.toISOString(),
      authors: [post.data.author],
      locale: 'zh_CN',
    },
    twitter: {
      card: 'summary_large_image',
      title: post.data.title,
      description: post.data.description,
    },
    alternates: {
      canonical: url,
    },
  };
}
