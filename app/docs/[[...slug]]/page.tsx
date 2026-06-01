import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsPage, DocsBody } from "fumadocs-ui/page";
import { docsSource } from "@/lib/source";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const page = docsSource.getPage(slug);

  if (!page) notFound();

  const { body: Mdx } = await page.data.load();

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

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
