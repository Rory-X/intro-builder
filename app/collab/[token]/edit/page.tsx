import { db } from "@/db";
import { collabSessions, resumes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { CollabEditorClient } from "@/components/collab/collab-editor-client";
import { migrateContent } from "@/lib/migrate-content";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "协作编辑" };

export default async function MentorEditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [session] = await db.select().from(collabSessions).where(
    eq(collabSessions.inviteToken, token),
  ).limit(1);

  if (!session || session.expiresAt < new Date()) notFound();

  const [resume] = await db.select().from(resumes).where(
    eq(resumes.id, session.resumeId),
  ).limit(1);

  if (!resume) notFound();

  const content = migrateContent(resume.content);

  return (
    <CollabEditorClient
      resumeTitle={resume.title}
      resumeContent={content}
      templateId={resume.templateId}
      mode={session.mode as "edit" | "comment"}
      role="mentor"
    />
  );
}
