import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { migrateContent } from "@intro-builder/shared/utils";
import { TemplateRender } from "@/lib/templates/render-server";
import { withDbRetry } from "@/lib/db-retry";

export const revalidate = 60;

export const metadata: Metadata = {
  robots: {
    index: false,      // Prevent indexing
    follow: false,     // Prevent following links
    nocache: true,     // Prevent caching
  },
};

export default async function PublicResume({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await withDbRetry("publicResume.load", () =>
    db.query.resumes.findFirst({
      where: and(eq(resumes.slug, slug), eq(resumes.isPublic, true)),
    }),
  );
  if (!row) notFound();
  const content = migrateContent(row.content);
  return (
    <main className="bg-muted py-8">
      <TemplateRender
        id={row.templateId}
        content={content}
        sectionOrder={content.sectionOrder}
        styleSettings={content.styleSettings}
      />
    </main>
  );
}
