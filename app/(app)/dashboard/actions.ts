"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { emptyResumeContent } from "@/lib/resume-schema";
import { withDbRetry } from "@/lib/db-retry";
import {
  getDefaultTemplateId,
  getTemplateMetaAsync,
} from "@/lib/templates/registry-server";

export async function createResume() {
  const userId = await requireUserId();
  const templateId = await getDefaultTemplateId();
  const [row] = await withDbRetry("createResume", () =>
    db.insert(resumes).values({
      userId,
      title: "新简历",
      templateId,
      content: emptyResumeContent(),
    }).returning({ id: resumes.id }),
  );
  revalidatePath("/dashboard");
  redirect(`/resume/${row.id}/edit`);
}

export async function deleteResume(id: string) {
  const userId = await requireUserId();
  await withDbRetry("deleteResume", () =>
    db.delete(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, userId))),
  );
  revalidatePath("/dashboard");
}

export async function duplicateResume(sourceId: string) {
  const userId = await requireUserId();
  const source = await withDbRetry("duplicateResume.read", () =>
    db.query.resumes.findFirst({
      where: and(eq(resumes.id, sourceId), eq(resumes.userId, userId)),
    }),
  );
  if (!source) redirect("/dashboard");
  const resolved = await getTemplateMetaAsync(source.templateId);
  const [row] = await withDbRetry("duplicateResume.write", () =>
    db.insert(resumes).values({
      userId,
      title: `${source.title} (副本)`,
      templateId: resolved.id,
      content: source.content,
    }).returning({ id: resumes.id }),
  );
  revalidatePath("/dashboard");
  redirect(`/resume/${row.id}/edit`);
}
