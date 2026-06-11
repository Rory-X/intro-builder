import { db } from "@/db";
import { collabSessions, resumes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { MentorEditorClient } from "@/components/collab/mentor-editor-client";
import { migrateContent } from "@intro-builder/shared/utils";
import { getTemplateMetaAsync } from "@/lib/templates/registry-server";
import { toSerializable } from "@/lib/templates/render";
import { withDbRetry } from "@/lib/db-retry";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "协作编辑" };

export default async function MentorEditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [session] = await withDbRetry("collab.session", () =>
    db.select().from(collabSessions).where(
      eq(collabSessions.inviteToken, token),
    ).limit(1),
  );

  if (!session || session.expiresAt < new Date()) notFound();

  const [resume] = await withDbRetry("collab.resume", () =>
    db.select().from(resumes).where(
      eq(resumes.id, session.resumeId),
    ).limit(1),
  );

  if (!resume) notFound();

  const content = migrateContent(resume.content);
  const resolvedTemplate = toSerializable(
    await getTemplateMetaAsync(resume.templateId),
  );

  return (
    <MentorEditorClient
      resumeTitle={resume.title}
      initialContent={content}
      resolvedTemplate={resolvedTemplate}
      mode={session.mode as "edit" | "comment"}
    />
  );
}
