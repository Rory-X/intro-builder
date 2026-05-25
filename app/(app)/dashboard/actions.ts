"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { emptyResumeContent } from "@/lib/resume-schema";
import { DEFAULT_TEMPLATE_ID } from "@/lib/templates/types";
import { getTemplateMetaAsync } from "@/lib/templates/registry-server";

export async function createResume() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Route the default through getTemplateMetaAsync so the persisted id is
  // always a real, currently-resolvable template — even if DEFAULT_TEMPLATE_ID
  // is renamed or removed later, this won't blindly insert a stale id.
  const resolved = await getTemplateMetaAsync(DEFAULT_TEMPLATE_ID);
  const [row] = await db.insert(resumes).values({
    userId: session.user.id,
    title: "新简历",
    templateId: resolved.id,
    content: emptyResumeContent(),
  }).returning({ id: resumes.id });
  revalidatePath("/dashboard");
  redirect(`/resume/${row.id}/edit`);
}

export async function deleteResume(id: string) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  await db.delete(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, session.user.id)));
  revalidatePath("/dashboard");
}

export async function duplicateResume(sourceId: string) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const source = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, sourceId), eq(resumes.userId, session.user.id)),
  });
  if (!source) redirect("/dashboard");
  // Re-resolve the source's templateId so a duplicate of a resume whose
  // uploaded template was deleted falls back to the default rather than
  // carrying an unresolvable id forward.
  const resolved = await getTemplateMetaAsync(source.templateId);
  const [row] = await db.insert(resumes).values({
    userId: session.user.id,
    title: `${source.title} (副本)`,
    templateId: resolved.id,
    content: source.content,
  }).returning({ id: resumes.id });
  revalidatePath("/dashboard");
  redirect(`/resume/${row.id}/edit`);
}
