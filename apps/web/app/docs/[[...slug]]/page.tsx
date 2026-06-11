import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsPage, DocsBody } from "fumadocs-ui/page";
import { docsSource } from "@/lib/source";
import { SEO_CONFIG } from "@/lib/seo-config";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const page = docsSource.getPage(slug);

  if (!page) notFound();

  const Mdx = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsBody>
        <h1 className="text-3xl font-bold">{page.data.title}</h1>
        {page.data.description && (
          <p className="text-lg text-fd-muted-foreground mt-2 mb-6">
            {page.data.description}
          </p>
        )}
        <Mdx />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return docsSource.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = docsSource.getPage(slug);

  if (!page) return {};

  const url = `${SEO_CONFIG.siteUrl}${page.url}`;

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url,
      type: 'article',
      locale: 'zh_CN',
    },
    twitter: {
      card: 'summary',
      title: page.data.title,
      description: page.data.description,
    },
    alternates: {
      canonical: url,
    },
  };
}
