import { eq, desc } from "drizzle-orm";
import type { Metadata } from "next";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { withDbRetry } from "@/lib/db-retry";
import { listUploadedTemplates } from "@/lib/templates/uploaded/fetch";
import { getTemplateMetaAsync } from "@/lib/templates/registry-server";
import { migrateContent } from "@/lib/migrate-content";
import { demoResume } from "@/lib/demo-resume";
import {
  uploadedTemplateToSerializable,
  toSerializable,
  type SerializableResolvedTemplate,
} from "@/lib/templates/render";
import type { PickerResume } from "@/components/templates/resume-picker-dialog";
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

  // 拉用户全部简历（最近修改在前），供「应用到哪份简历」选择弹窗用。
  const list = await withDbRetry("templates.list", () =>
    db
      .select()
      .from(resumes)
      .where(eq(resumes.userId, userId))
      .orderBy(desc(resumes.updatedAt)),
  );

  // 去重 resolve 每个用到的模板：同一模板被多份简历用时只 resolve 一次、
  // 只下发一份 html+css。按 resume 原始 templateId 做 key（即使 resolve 回退到
  // default，查的时候也用同一个原始 id，对得上）。
  const uniqueTemplateIds = [...new Set(list.map((r) => r.templateId))];
  const resumeTemplates: Record<string, SerializableResolvedTemplate> =
    Object.fromEntries(
      await Promise.all(
        uniqueTemplateIds.map(
          async (tid) =>
            [tid, toSerializable(await getTemplateMetaAsync(tid))] as const,
        ),
      ),
    );

  // 逐份迁移内容（per-resume try/catch：单份坏内容只跳过，不黑屏整页，
  // 沿用旧版对 migrateContent 失败的容错策略）。
  const userResumes: PickerResume[] = [];
  for (const r of list) {
    try {
      const content = migrateContent(r.content);
      userResumes.push({
        id: r.id,
        title: r.title,
        content,
        templateId: r.templateId,
        updatedLabel: formatRelativeTime(r.updatedAt),
      });
    } catch (error) {
      console.warn(
        `[templates] failed to migrate resume content for ${r.id}:`,
        error,
      );
    }
  }

  // 默认目标：带 ?resumeId= 且属于当前用户（list 已按 userId 过滤，能在
  // userResumes 里找到即归属本人）→ 用它；否则用最近修改那份；都没有则 null。
  const defaultResumeId =
    resumeIdParam && userResumes.some((r) => r.id === resumeIdParam)
      ? resumeIdParam
      : (userResumes[0]?.id ?? null);

  const uploaded = await listUploadedTemplates();
  const favoritedIds = await getFavoriteTemplateIds(userId);
  const resolvedList: SerializableResolvedTemplate[] = uploaded
    .filter((t) => t.html)
    .map((t): SerializableResolvedTemplate => uploadedTemplateToSerializable(t.id, t));

  return (
    <TemplateLibraryClient
      templates={resolvedList}
      userResumes={userResumes}
      resumeTemplates={resumeTemplates}
      defaultResumeId={defaultResumeId}
      demoResume={demoResume}
      favoritedIds={favoritedIds}
    />
  );
}

/** 相对修改时间标签：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期。 */
function formatRelativeTime(date: Date): string {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString("zh-CN");
}
