import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { migrateContent } from "@intro-builder/shared/utils";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { withDbRetry } from "@/lib/db-retry";
import EditorClient from "./editor-client";
import {
  getTemplateMetaAsync,
  listAllTemplatesAsync,
} from "@/lib/templates/registry-server";
import { listUploadedTemplates } from "@/lib/templates/uploaded/fetch";
import { getFavoriteTemplateIds } from "@/app/(app)/templates/actions";
import { toSerializable } from "@/lib/templates/render";
import { readAgentSurface } from "@/lib/agent/surface";
import { initializeIdentitiesInStore } from "@/lib/resume-mutations/identity-store";
import { initializeItemIdentities } from "@/lib/resume-mutations/identity";
import { db as database } from "@/db";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "编辑简历" };

export default async function EditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const { from } = await searchParams;
  const userId = await requireUserId();
  const row = await withDbRetry("EditPage.resumeLookup", () =>
    db.query.resumes.findFirst({
      where: and(eq(resumes.id, id), eq(resumes.userId, userId)),
    }),
  );
  if (!row) notFound();

  /*
   * 条目身份初始化（P03 任务 3）。
   *
   * 这是 owner 的**可写会话入口**，所以在这里补齐缺失的稳定身份：
   * 提交模块要求每条命令按 `itemId` 定位，没有身份的旧文档必须先补齐，
   * 否则编辑器会被 editor-adapter 判定为 `needs_identity` 而拒绝保存。
   *
   * 关键约束（见 identity-store.ts）：
   * - 用**内容 CAS**，因此并发打开同一份旧简历只有一个写入；
   * - **不推进 revision**（它没有改变用户的文案/顺序）；
   * - `concurrent_edit` 表示期间有真实编辑 —— 此时放弃本次初始化，
   *   直接读取最新内容即可，绝不覆盖。
   *
   * 公开只读路径（`/r/[slug]`、PDF 渲染）**不得**调用这里。
   */
  const identityOutcome = await initializeIdentitiesInStore(
    { execute: (statement) => database.execute(statement) },
    {
      resumeId: row.id,
      userId,
      prepare: (content) => {
        const result = initializeItemIdentities({
          resumeId: row.id,
          content: content as Parameters<typeof initializeItemIdentities>[0]["content"],
        });
        if (!result.ok) return { ok: false as const, reason: result.reason };
        return {
          ok: true as const,
          content: result.content,
          changed: result.changed,
          assignedCount: result.assigned.length,
        };
      },
    },
  );

  // 初始化成功或期间被编辑，都以「库里的最新状态」为准重新读取，
  // 避免把补齐前的内容渲染给用户。
  const currentRow =
    identityOutcome.status === "initialized" || identityOutcome.status === "concurrent_edit"
      ? ((await withDbRetry("EditPage.reloadAfterIdentity", () =>
          db.query.resumes.findFirst({
            where: and(eq(resumes.id, id), eq(resumes.userId, userId)),
          }),
        )) ?? row)
      : row;
  // Pre-resolve the current template + the merged template gallery + the
  // full set of uploaded templates so the client editor can dispatch
  // UploadedLayout vs built-in without making a round trip on every
  // templateId change. Bundle size scales with uploaded-template count
  // (Option C from the foundation plan); revisit if that count grows past
  // a few hundred.
  const [initialResolved, allTemplates, dbUploadedTemplates, favoritedTemplateIds] = await Promise.all([
    getTemplateMetaAsync(currentRow.templateId),
    listAllTemplatesAsync(),
    listUploadedTemplates(),
    getFavoriteTemplateIds(userId),
  ]);
  return (
    <EditorClient
      userId={userId}
      id={row.id}
      initialTitle={currentRow.title}
      initialRevision={currentRow.revision}
      initialTemplate={initialResolved.id}
      initialContent={migrateContent(currentRow.content)}
      initialIsPublic={currentRow.isPublic}
      initialSlug={currentRow.slug ?? null}
      initialUpdatedAtIso={currentRow.updatedAt.toISOString()}
      initialNowIso={new Date().toISOString()}
      initialResolvedTemplate={toSerializable(initialResolved)}
      uploadedTemplates={dbUploadedTemplates}
      allTemplates={allTemplates}
      favoritedTemplateIds={favoritedTemplateIds}
      agentSurface={readAgentSurface()}
      from={from ?? null}
    />
  );
}
