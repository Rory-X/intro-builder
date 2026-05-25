"use server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { ResumeContent } from "@/lib/resume-schema";
import { newSlug } from "@/lib/slug";
import { getTemplateMetaAsync } from "@/lib/templates/registry-server";
import type { TemplateId } from "@/lib/templates/registry";

export async function saveResume(id: string, content: unknown, title?: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const parsed = ResumeContent.safeParse(content);
  if (!parsed.success) throw new Error("invalid: " + parsed.error.message);
  await db.update(resumes)
    .set({
      content: parsed.data,
      ...(title ? { title } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(resumes.id, id), eq(resumes.userId, session.user.id)));
}

export async function setTemplate(id: string, templateId: TemplateId) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  // Route through getTemplateMetaAsync so that an id which was valid at
  // selection time but has since been deleted from the DB is collapsed to
  // the default before persisting. Mirrors the dashboard's createResume /
  // duplicateResume pattern: an unresolvable id is silently downgraded to
  // the default rather than being trusted into the row.
  const resolved = await getTemplateMetaAsync(templateId);
  await db.update(resumes).set({ templateId: resolved.id, updatedAt: new Date() })
    .where(and(eq(resumes.id, id), eq(resumes.userId, session.user.id)));
}

export async function toggleShare(
  id: string,
  enable: boolean,
): Promise<{ slug: string | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const slug = enable ? newSlug() : null;
  await db
    .update(resumes)
    .set({ isPublic: enable, slug, updatedAt: new Date() })
    .where(and(eq(resumes.id, id), eq(resumes.userId, session.user.id)));
  return { slug };
}
