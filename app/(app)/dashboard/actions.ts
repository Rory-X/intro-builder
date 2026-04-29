"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { emptyResumeContent } from "@/lib/resume-schema";

export async function createResume() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [row] = await db.insert(resumes).values({
    userId: session.user.id,
    title: "新简历",
    templateId: "classic",
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
  const [row] = await db.insert(resumes).values({
    userId: session.user.id,
    title: `${source.title} (副本)`,
    templateId: source.templateId,
    content: source.content,
  }).returning({ id: resumes.id });
  revalidatePath("/dashboard");
  redirect(`/resume/${row.id}/edit`);
}
