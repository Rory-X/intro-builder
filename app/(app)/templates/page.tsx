import { eq, desc } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { TEMPLATES } from "@/lib/templates/registry";
import { listUploadedTemplates } from "@/lib/templates/uploaded/fetch";
import { migrateContent } from "@/lib/migrate-content";
import { demoResume } from "@/lib/demo-resume";
import type { ResumeContent } from "@/lib/resume-schema";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import type { BuiltinTemplateId } from "@/lib/templates/types";
import { getFavoriteTemplateIds } from "./actions";
import { TemplateLibraryClient } from "./template-library-client";

export const metadata: Metadata = { title: "模板库" };

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; resumeId?: string }>;
}) {
  const userId = await requireUserId();
  const { resumeId: resumeIdParam } = await searchParams;

  // 拉用户最近一份简历当 "use my content" toggle 的数据源。
  // 如果带 ?resumeId= 来自编辑器，优先用那一份；否则按 updatedAt 取最近的。
  // resumeId 必须 belong to 当前用户 —— 否则被忽略走 fallback（不暴露不属于
  // 该用户的简历内容）。
  let userResumeRow: typeof resumes.$inferSelect | undefined = undefined;
  if (resumeIdParam) {
    userResumeRow = await db.query.resumes.findFirst({
      where: (r, { eq: eqq, and }) =>
        and(eqq(r.id, resumeIdParam), eqq(r.userId, userId)),
    });
  }
  if (!userResumeRow) {
    userResumeRow = await db.query.resumes.findFirst({
      where: eq(resumes.userId, userId),
      orderBy: [desc(resumes.updatedAt)],
    });
  }

  // 走 migrateContent 走老 schema 升级路径（和 dashboard 一致）。失败时
  // 兜底成 null（toggle 默认 off 用 demo 内容），不让整个 gallery 黑屏。
  let userResume: { id: string; content: ResumeContent } | null = null;
  if (userResumeRow) {
    try {
      const content = migrateContent(userResumeRow.content);
      userResume = { id: userResumeRow.id, content };
    } catch (error) {
      console.warn(
        `[templates] failed to migrate resume content for ${userResumeRow.id}:`,
        error,
      );
    }
  }

  // 合并 builtin + uploaded 成 SerializableResolvedTemplate[] —— 这是
  // SC → CC 边界类型（剥掉了 ComponentType<Layout> 等不可序列化字段）。
  // 客户端用 ClientTemplateRenderFromSerializable 重建 Layout（builtin
  // 通过 id 在客户端的 TEMPLATES 静态表查找，uploaded 通过 template 字段
  // 自带数据）。
  const uploaded = await listUploadedTemplates();
  const favoritedIds = await getFavoriteTemplateIds(userId);
  const builtinIds = new Set(TEMPLATES.map((t) => t.id));
  const resolvedList: SerializableResolvedTemplate[] = [
    ...TEMPLATES.map(
      (t): SerializableResolvedTemplate => ({
        source: "builtin",
        id: t.id as BuiltinTemplateId,
      }),
    ),
    ...uploaded
      .filter((t) => !builtinIds.has(t.id))
      .map(
        (t): SerializableResolvedTemplate => ({
          source: "uploaded",
          id: t.id,
          template: t,
        }),
      ),
  ];

  return (
    <TemplateLibraryClient
      templates={resolvedList}
      userResume={userResume}
      demoResume={demoResume}
      favoritedIds={favoritedIds}
    />
  );
}
