import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsBody } from "fumadocs-ui/page";
import { blogSource } from "@/lib/source";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function BlogPost({ params }: PageProps) {
  const { slug } = await params;
  const post = blogSource.getPage([slug]);

  if (!post || post.data.draft) notFound();

  const { body: Mdx } = await post.data.load();

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
      <DocsBody>
        <Mdx />
      </DocsBody>
    </article>
  );
}

export function generateStaticParams() {
  return blogSource.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = blogSource.getPage([slug]);

  if (!post) return {};

  return {
    title: post.data.title,
    description: post.data.description,
  };
}
