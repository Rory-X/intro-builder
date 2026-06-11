import type { Metadata } from "next";
import Link from "next/link";
import { blogSource } from "@/lib/source";

export const metadata: Metadata = {
  title: "博客",
  description: "求职资讯、招聘季提醒、行业洞察",
};

export default function BlogIndex() {
  const posts = blogSource.getPages()
    .filter((post) => !post.data.draft)
    .sort((a, b) => {
      const dateA = new Date(a.data.date ?? 0).getTime();
      const dateB = new Date(b.data.date ?? 0).getTime();
      return dateB - dateA;
    });

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">博客</h1>
      <p className="text-muted-foreground mb-8">求职资讯、招聘季提醒、行业洞察</p>
      <div className="space-y-8">
        {posts.map((post) => (
          <article key={post.url} className="group">
            <Link href={post.url} className="block">
              <h2 className="text-xl font-semibold group-hover:text-primary transition-colors">
                {post.data.title}
              </h2>
              {post.data.description && (
                <p className="text-muted-foreground mt-1">{post.data.description}</p>
              )}
              <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                {post.data.date && (
                  <time dateTime={new Date(post.data.date).toISOString()}>
                    {new Date(post.data.date).toLocaleDateString("zh-CN")}
                  </time>
                )}
                {post.data.tags && post.data.tags.length > 0 && (
                  <div className="flex gap-1.5">
                    {post.data.tags.map((tag: string) => (
                      <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          </article>
        ))}
        {posts.length === 0 && (
          <p className="text-muted-foreground">暂无文章，敬请期待。</p>
        )}
      </div>
    </div>
  );
}
