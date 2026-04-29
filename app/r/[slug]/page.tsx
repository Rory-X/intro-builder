import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { migrateContent } from "@/lib/migrate-content";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { ModernLayout } from "@/lib/templates/modern/Layout";

export const revalidate = 60;

export default async function PublicResume({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await db.query.resumes.findFirst({
    where: and(eq(resumes.slug, slug), eq(resumes.isPublic, true)),
  });
  if (!row) notFound();
  const content = migrateContent(row.content);
  const Layout = row.templateId === "modern" ? ModernLayout : ClassicLayout;
  return (
    <main className="bg-muted py-8">
      <Layout content={content} sectionOrder={content.sectionOrder} styleSettings={content.styleSettings} />
    </main>
  );
}
