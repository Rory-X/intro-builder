"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { emptyResumeContent } from "@intro-builder/shared/schemas";
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

/**
 * 新建一份空简历并直接套用指定模板 —— 模板库「应用到简历」弹窗的「＋新建简历」
 * 走这条。templateId 经 getTemplateMetaAsync 校验（未知 id 收敛为 default），
 * 与 setTemplate 一致，不会写入不存在的模板。
 *
 * 返回新简历 id 交给客户端 router.push 跳转，**不在这里 redirect()** —— 该函数
 * 由 client 组件 await 调用，redirect() 抛出的 NEXT_REDIRECT 会被调用方的
 * try/catch 吞掉，导致"建好了却不跳转、还弹失败提示"。与 setTemplate 同款：
 * action 只写库 + 返回数据，跳转归 client。
 */
export async function createResumeWithTemplate(templateId: string): Promise<{ id: string }> {
  const userId = await requireUserId();
  const resolved = await getTemplateMetaAsync(templateId);
  const [row] = await withDbRetry("createResumeWithTemplate", () =>
    db.insert(resumes).values({
      userId,
      title: "新简历",
      templateId: resolved.id,
      content: emptyResumeContent(),
    }).returning({ id: resumes.id }),
  );
  revalidatePath("/dashboard");
  return { id: row.id };
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
