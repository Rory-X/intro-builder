import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { ResumeContent } from "@/lib/resume-schema";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { ModernLayout } from "@/lib/templates/modern/Layout";

export const revalidate = 60;

export default async function PublicResume({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await db.query.resumes.findFirst({
    where: and(eq(resumes.slug, slug), eq(resumes.isPublic, true)),
  });
  if (!row) notFound();
  const parsed = ResumeContent.safeParse(row.content);
  if (!parsed.success) notFound();
  const Layout = row.templateId === "modern" ? ModernLayout : ClassicLayout;
  return (
    <main className="bg-slate-100 py-8">
      <Layout content={parsed.data} />
    </main>
  );
}
