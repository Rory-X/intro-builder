import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { migrateContent } from "@/lib/migrate-content";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import EditorClient from "./editor-client";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "编辑简历" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  const row = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, id), eq(resumes.userId, userId)),
  });
  if (!row) notFound();
  return (
    <EditorClient
      id={row.id}
      initialTitle={row.title}
      initialTemplate={row.templateId as "classic" | "modern"}
      initialContent={migrateContent(row.content)}
      initialIsPublic={row.isPublic}
      initialSlug={row.slug ?? null}
    />
  );
}
