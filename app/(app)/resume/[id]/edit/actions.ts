"use server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { ResumeContent } from "@/lib/resume-schema";

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

export async function setTemplate(id: string, templateId: "classic" | "modern") {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  await db.update(resumes).set({ templateId, updatedAt: new Date() })
    .where(and(eq(resumes.id, id), eq(resumes.userId, session.user.id)));
}
