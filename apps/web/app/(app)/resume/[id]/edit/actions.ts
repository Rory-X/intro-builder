"use server";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumeVersions, resumes } from "@/db/schema";
import { ResumeContent } from "@intro-builder/shared/schemas";
import { migrateContent, newSlug } from "@intro-builder/shared/utils";
import { withDbRetry } from "@/lib/db-retry";
import {
  getTemplateMetaAsync,
  getTemplateDefaultStyleSettings,
} from "@/lib/templates/registry-server";
import type { TemplateId } from "@/lib/templates/registry";
import {
  commitResumeMutation,
  commitResumeRestore,
  type CommitPrincipal,
} from "@/lib/resume-mutations/commit";
import { buildApplyTemplateOperations } from "@/lib/resume-mutations/editor-adapter";
import {
  sourceLabel as versionSourceLabel,
  type VersionSource,
} from "@/lib/ai-client/version-history";

/*
 * 来源类型与标签统一从 `lib/ai-client/version-history` 取。
 *
 * 此前这里是本地定义，只认 3 种来源，而提交层实际会写 9 种 ——
 * `polish` / `template` / `style` / `collab` / `undo` 全被显示成「手动保存」，
 * 等于对用户**谎报来源**（例如 AI 润色显示成「手动保存」）。
 */
type ResumeVersionSource = VersionSource;

export type CreateResumeVersionInput = {
  resumeId: string;
  title: string;
  templateId: string;
  content: unknown;
  source: ResumeVersionSource;
  operationCount: number;
  summary?: string | null;
  actorName?: string | null;
  parentVersionId?: string | null;
};

export type ResumeVersionListItem = {
  id: string;
  resumeId: string;
  source: ResumeVersionSource;
  sourceLabel: string;
  actorName: string;
  operationCount: number;
  summary: string | null;
  createdAt: string;
  /*
   * 以下字段是 P06 任务 5 的聚合与撤销所需。
   *
   * 数据库里一直有它们（迁移 0014），提交层也一直在写，
   * 但此前既没在 Drizzle schema 里声明、也没在这里读取 ——
   * 因此 UI 无法「按任务聚合」、无法「跳回任务」，撤销也拿不到 mutationId。
   * 现在一并补上。
   */
  revision: number | null;
  runId: string | null;
  changeSetId: string | null;
  mutationId: string | null;
};

/**
 * Dev bypass mirror of `requireUserId` for server actions.
 *
 * **Critical**: real session takes priority. If a user is actually logged
 * in (their real account), use their real id — dev bypass MUST NOT
 * override a real session, otherwise mutations from real users go against
 * dev-user's row and their own data appears unchanged.
 */
async function actionUserId(): Promise<string> {
  // Real session first.
  const session = await auth();
  if (session?.user?.id) return session.user.id;
  // No session: dev bypass kicks in only if explicitly enabled.
  if (
    process.env.NODE_ENV === "development" &&
    process.env.AUTH_DEV_BYPASS === "1" &&
    process.env.AUTH_DEV_USER_ID
  ) {
    return process.env.AUTH_DEV_USER_ID;
  }
  throw new Error("unauthorized");
}

async function actionUser(): Promise<{ id: string; name: string }> {
  const session = await auth();
  if (session?.user?.id) {
    return {
      id: session.user.id,
      name: session.user.name || session.user.email || "我",
    };
  }
  if (
    process.env.NODE_ENV === "development" &&
    process.env.AUTH_DEV_BYPASS === "1" &&
    process.env.AUTH_DEV_USER_ID
  ) {
    return {
      id: process.env.AUTH_DEV_USER_ID,
      name: process.env.AUTH_DEV_USER_NAME || "我",
    };
  }
  throw new Error("unauthorized");
}

/** 来源标签（9 种来源各有正确文案，不再是「其余都算手动保存」）。 */
const sourceLabel = versionSourceLabel;

async function ensureResumeOwner(resumeId: string, userId: string) {
  const rows = await withDbRetry("resumeVersion.owner", () =>
    db
      .select({ id: resumes.id, userId: resumes.userId })
      .from(resumes)
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .limit(1),
  );
  if (!rows[0]) throw new Error("not found");
}

export async function createResumeVersion(input: CreateResumeVersionInput) {
  const user = await actionUser();
  await ensureResumeOwner(input.resumeId, user.id);
  const parsed = ResumeContent.safeParse(input.content);
  if (!parsed.success) throw new Error("invalid: " + parsed.error.message);
  const versionId = crypto.randomUUID();
  const createdAt = new Date();
  const operationCount = Math.max(1, input.operationCount);
  const actorName = input.actorName || user.name;

  await withDbRetry("createResumeVersion", () =>
    db.insert(resumeVersions).values({
      id: versionId,
      resumeId: input.resumeId,
      userId: user.id,
      title: input.title,
      templateId: input.templateId,
      content: parsed.data,
      source: input.source,
      actorName,
      operationCount,
      summary: input.summary ?? null,
      parentVersionId: input.parentVersionId ?? null,
      createdAt,
    }),
  );
  return {
    id: versionId,
    resumeId: input.resumeId,
    source: input.source,
    sourceLabel: sourceLabel(input.source),
    actorName,
    operationCount,
    summary: input.summary ?? null,
    createdAt: createdAt.toISOString(),
    /*
     * 这条辅助函数创建的是「本地新版本」，不携带聚合与撤销信息 ——
     * 那些字段来自提交层的真实回执。显式写 null 而不是省略：
     * 省略会让类型校验失败，而用 `as` 强转会掩盖「这个入口确实没有这些信息」
     * 这一事实。
     */
    revision: null,
    runId: null,
    changeSetId: null,
    mutationId: null,
  } satisfies ResumeVersionListItem;
}

export async function listResumeVersions(resumeId: string): Promise<ResumeVersionListItem[]> {
  const userId = await actionUserId();
  const rows = await withDbRetry("listResumeVersions", () =>
    db
      .select({
        id: resumeVersions.id,
        resumeId: resumeVersions.resumeId,
        source: resumeVersions.source,
        actorName: resumeVersions.actorName,
        operationCount: resumeVersions.operationCount,
        summary: resumeVersions.summary,
        createdAt: resumeVersions.createdAt,
        revision: resumeVersions.revision,
        runId: resumeVersions.runId,
        changeSetId: resumeVersions.changeSetId,
        mutationId: resumeVersions.mutationId,
      })
      .from(resumeVersions)
      .where(and(eq(resumeVersions.resumeId, resumeId), eq(resumeVersions.userId, userId)))
      .orderBy(desc(resumeVersions.createdAt))
      .limit(50),
  );

  return rows.map((row) => ({
    ...row,
    sourceLabel: sourceLabel(row.source),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getResumeVersion(resumeId: string, versionId: string) {
  const userId = await actionUserId();
  const rows = await withDbRetry("getResumeVersion", () =>
    db
      .select()
      .from(resumeVersions)
      .where(and(
        eq(resumeVersions.id, versionId),
        eq(resumeVersions.resumeId, resumeId),
        eq(resumeVersions.userId, userId),
      ))
      .limit(1),
  );
  const row = rows[0];
  if (!row) throw new Error("not found");
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 恢复历史版本（P03 任务 5：恢复也必须走统一提交）。
 *
 * 旧实现是**第二个不受保护的写入口**：先 insert 一条备份版本，再 update 正文，
 * 两条独立 SQL、不带 revision、也不经过提交模块。它带来三个问题：
 * 1. 与编辑器的并发保护脱节 —— 两个标签页可以同时「恢复」，后写者静默赢；
 * 2. 「恢复前自动备份」和「正文变更」不是一个原子操作，中途失败会留下
 *    只有备份没有恢复（或反之）的错乱状态；
 * 3. 它写出的版本记录不带 revision 链，历史 UI 无法把它挂到某次任务上。
 *
 * 现在它只做**读取与校验**，真正的写入交给 `submitResumeVersionRestore`：
 * 由提交模块在**同一条 SQL** 里更新正文、写 restore 快照、写回执与事件，
 * 并检查 revision。恢复前后的内容都完整保留。
 */
export async function loadResumeVersionForRestore(resumeId: string, versionId: string) {
  const user = await actionUser();
  const rows = await withDbRetry("loadVersionForRestore.read", () =>
    db
      .select()
      .from(resumeVersions)
      .where(and(
        eq(resumeVersions.id, versionId),
        eq(resumeVersions.resumeId, resumeId),
        eq(resumeVersions.userId, user.id),
      ))
      .limit(1),
  );
  const version = rows[0];
  if (!version) throw new Error("not found");
  const parsed = ResumeContent.safeParse(version.content);
  if (!parsed.success) throw new Error("invalid: " + parsed.error.message);
  return {
    title: version.title,
    templateId: version.templateId,
    content: parsed.data,
  };
}

/**
 * 以一次原子提交把简历恢复到指定历史版本。
 *
 * `expectedRevision` 由调用方（编辑器）提供，必须是从服务端读到的当前值 ——
 * 这样并发的两次恢复只有一次能成功，另一次会拿到冲突而不是静默覆盖。
 */
export async function submitResumeVersionRestore(input: {
  resumeId: string;
  mutationId: string;
  expectedRevision: number;
  versionId: string;
  summary?: string | null;
}): Promise<SubmitResumeMutationResult> {
  const user = await actionUser();
  const target = await loadResumeVersionForRestore(input.resumeId, input.versionId);

  /*
   * 恢复 = 一次「全量还原」提交。
   *
   * 这里刻意不构造逐字段的差量：恢复的语义就是「整份内容变成历史版本」，
   * 逐字段 diff 会在同字段被并发修改时产出难以解释的部�分恢复。
   * 提交模块的 `restore` 源会保留恢复前后的完整快照。
   */
  const outcome = await commitResumeRestore(
    {
      userId: user.id,
      actorName: user.name,
      source: "restore",
      summary: input.summary ?? `恢复到历史版本`,
    },
    {
      mutationId: input.mutationId,
      resumeId: input.resumeId,
      expectedRevision: input.expectedRevision,
      targetContent: target.content,
      targetTitle: target.title,
      targetTemplateId: target.templateId,
      restoreFromVersionId: input.versionId,
    },
  );

  switch (outcome.status) {
    case "committed":
      return {
        status: "committed",
        revision: outcome.result.revision,
        versionId: outcome.result.versionId,
        nextContent: outcome.nextContent,
      };
    case "conflict":
      return { status: "conflict", currentRevision: outcome.result.currentRevision };
    case "no_change":
      return { status: "no_change", currentRevision: outcome.result.currentRevision };
    case "rejected":
      return { status: "rejected", code: outcome.result.code };
  }
}

export type SaveResumeResult = {
  id: string;
  title: string;
  content: ResumeContent;
};

export async function saveResume(
  id: string,
  content: unknown,
  title?: string,
): Promise<SaveResumeResult> {
  const userId = await actionUserId();
  const parsed = ResumeContent.safeParse(content);
  if (!parsed.success) throw new Error("invalid: " + parsed.error.message);
  const updatedRows = await withDbRetry("saveResume.write", () =>
    db
      .update(resumes)
      .set({
        content: parsed.data,
        ...(title !== undefined ? { title } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
      .returning({ id: resumes.id }),
  );
  if (updatedRows.length === 0) throw new Error("not found");

  const rows = await withDbRetry("saveResume.readback", () =>
    db
      .select({
        id: resumes.id,
        title: resumes.title,
        content: resumes.content,
      })
      .from(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
      .limit(1),
  );
  const row = rows[0];
  if (!row) throw new Error("not found");
  const savedContent = ResumeContent.safeParse(row.content);
  if (!savedContent.success) {
    throw new Error("save verification failed: invalid readback content");
  }
  if (!isDeepStrictEqual(savedContent.data, parsed.data)) {
    throw new Error("save verification failed: content mismatch");
  }
  if (title !== undefined && row.title !== title) {
    throw new Error("save verification failed: title mismatch");
  }

  return {
    id: row.id,
    title: row.title,
    content: savedContent.data,
  };
}

export async function setTemplate(
  id: string,
  templateId: TemplateId,
  options?: { resetStyleSettings?: boolean },
) {
  const userId = await actionUserId();
  // Route through getTemplateMetaAsync so that an id which was valid at
  // selection time but has since been deleted from the DB is collapsed to
  // the default before persisting. Mirrors the dashboard's createResume /
  // duplicateResume pattern: an unresolvable id is silently downgraded to
  // the default rather than being trusted into the row.
  const resolved = await getTemplateMetaAsync(templateId);
  // resetStyleSettings 默认 true：切模板=切排版的心智模型成立。除非调用方
  // 明确传 false（"我只想换模板，保留我调好的字号/边距"），否则把模板的
  // defaultStyleSettings 写进 resume 的 styleSettings —— 让 modern 那种
  // 紧凑双栏不会被 standard 字号撑爆，也让用户切回 standard 时立刻拿到
  // 推荐间距，不用每次手调。Content / sectionOrder 永不动。
  const shouldReset = options?.resetStyleSettings ?? true;
  const update: Partial<typeof resumes.$inferInsert> = {
    templateId: resolved.id,
    updatedAt: new Date(),
  };
  if (shouldReset) {
    const existing = await withDbRetry("setTemplate.read", () =>
      db
        .select({ content: resumes.content })
        .from(resumes)
        .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
        .limit(1),
    );
    const row = existing[0];
    if (row && row.content && typeof row.content === "object") {
      const newSettings = getTemplateDefaultStyleSettings(resolved);
      // 走 cast：content 列是 jsonb，drizzle 推的是严格 ResumeContent 类型，
      // 但 row.content 已经是 trust-boundary 之内（之前 saveResume 用 Zod
      // 解析过），单字段 merge 不需要再走全量解析。cast 表达"读到什么就回写
      // 什么 + 改 styleSettings"的语义。
      update.content = {
        ...(row.content as Record<string, unknown>),
        styleSettings: newSettings,
      } as typeof resumes.$inferInsert.content;
    }
  }
  await withDbRetry("setTemplate.write", () =>
    db
      .update(resumes)
      .set(update)
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId))),
  );
}

export async function toggleShare(
  id: string,
  enable: boolean,
): Promise<{ slug: string | null }> {
  const userId = await actionUserId();
  const slug = enable ? newSlug() : null;
  await withDbRetry("toggleShare", () =>
    db
      .update(resumes)
      .set({ isPublic: enable, slug, updatedAt: new Date() })
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId))),
  );
  return { slug };
}

// ─── 统一的文档提交入口（P03） ────────────────────────────────

export type SubmitResumeMutationInput = {
  resumeId: string;
  mutationId: string;
  expectedRevision: number;
  operations: unknown;
  /** 由调用方声明来源；服务端仍会校验并决定 actor。 */
  source?: CommitPrincipal["source"];
  summary?: string | null;
  changeSetId?: string | null;
  /** 服务端工具（Agent）调用时由服务端侧传入 runId；浏览器不可伪造。 */
  runId?: string | null;
};

export type SubmitResumeMutationResult =
  | { status: "committed"; revision: number; versionId: string; nextContent: unknown }
  | { status: "conflict"; currentRevision: number }
  | { status: "no_change"; currentRevision: number }
  | { status: "rejected"; code: string };

/**
 * 把编辑器的语义命令提交到文档提交模块。
 *
 * 这一层只做两件事：**鉴权**与**可信上下文构造**。真正的校验、幂等、原子写入
 * 都在 `commitResumeMutation` 里 —— 绝不在 action 里重复实现一遍写入逻辑，
 * 否则「唯一写入口」就名存实亡。
 *
 * 安全约定（契约 §1）：`userId` / `actorName` / `source` 一律由服务端会话决定，
 * **不接受**请求体里自称的身份。浏览器只提供 `runId` 之外的业务参数。
 */
export async function submitResumeMutation(
  input: SubmitResumeMutationInput,
): Promise<SubmitResumeMutationResult> {
  const user = await actionUser();

  const outcome = await commitResumeMutation(
    {
      userId: user.id,
      actorName: user.name,
      // 编辑器的手动输入固定是 manual；Agent 路径由服务端另行构造 principal。
      source: input.source ?? "manual",
      summary: input.summary ?? null,
      changeSetId: input.changeSetId ?? null,
      runId: null,
    },
    {
      mutationId: input.mutationId,
      resumeId: input.resumeId,
      expectedRevision: input.expectedRevision,
      operations: input.operations,
    },
  );

  switch (outcome.status) {
    case "committed":
      return {
        status: "committed",
        revision: outcome.result.revision,
        versionId: outcome.result.versionId,
        nextContent: outcome.nextContent,
      };
    case "conflict":
      return { status: "conflict", currentRevision: outcome.result.currentRevision };
    case "no_change":
      return { status: "no_change", currentRevision: outcome.result.currentRevision };
    case "rejected":
      return { status: "rejected", code: outcome.result.code };
  }
}

/**
 * 读取编辑器需要的基准信息（正文、revision、title、templateId）。
 *
 * 只读，但仍须鉴权并校验 ownership —— 它是编辑器开始可写会话的起点。
 */
export async function getResumeMutationBaseline(resumeId: string): Promise<{
  content: unknown;
  revision: number;
  title: string;
  templateId: string;
} | null> {
  const userId = await actionUserId();
  const rows = await withDbRetry("resumeBaseline.read", () =>
    db
      .select({
        content: resumes.content,
        revision: resumes.revision,
        title: resumes.title,
        templateId: resumes.templateId,
      })
      .from(resumes)
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    content: row.content,
    revision: row.revision,
    title: row.title,
    templateId: row.templateId,
  };
}

/**
 * 把某个模板应用到已有简历（P03 统一写入的补漏路径）。
 *
 * 旧 `setTemplate` 是**第二个不受保护的写入口**：不带 revision、不写 mutation 留痕，
 * 且默认**整体覆盖** `styleSettings`。模板库页面走的就是它 —— 与编辑器并发时两边互相
 * 覆盖，事后也无法追溯是谁改的。P03 的统一写入只覆盖了编辑器，漏了这条路径。
 *
 * 现在它：
 * 1. 读出**权威基准**（内容 + revision）；
 * 2. 用 `buildApplyTemplateOperations` 产出 `set_template`（+ 可选的 `set_style`）；
 * 3. 经 `commitResumeMutation` 原子提交，因此受 revision 保护并留下回执。
 *
 * 返回结构刻意与 `SubmitResumeMutationResult` 一致，便于调用方统一处理冲突。
 */
export async function applyTemplateToResume(input: {
  resumeId: string;
  templateId: TemplateId;
  /** 客户端可传上一次读到的 revision；省略时由服务端现读（首屏直接点击的场景）。 */
  expectedRevision?: number;
  /** 是否连带重置排版（默认 true，沿用「切模板 = 切排版」的心智模型）。 */
  resetStyleSettings?: boolean;
}): Promise<SubmitResumeMutationResult> {
  const user = await actionUser();
  const resolved = await getTemplateMetaAsync(input.templateId);

  const baseline = await getResumeMutationBaseline(input.resumeId);
  if (!baseline) return { status: "rejected", code: "not_found" };

  const parsed = ResumeContent.safeParse(migrateContent(baseline.content));
  if (!parsed.success) {
    return { status: "rejected", code: "invalid_content" };
  }

  const shouldReset = input.resetStyleSettings ?? true;
  let opSeq = 0;
  const built = buildApplyTemplateOperations({
    baseline: parsed.data,
    baselineTemplateId: baseline.templateId,
    nextTemplateId: resolved.id,
    // 排版属于 content，因此重置通过额外的 set_style 操作表达（不是行级字段）。
    templateStyle: shouldReset
      ? (getTemplateDefaultStyleSettings(resolved) as unknown as Record<string, unknown>)
      : null,
    newOpId: () => `tpl-${Date.now().toString(36)}-${(opSeq += 1)}`,
  });

  const outcome = await commitResumeMutation(
    {
      userId: user.id,
      actorName: user.name,
      source: "template",
      summary: `应用模板 ${resolved.id}`,
    },
    {
      mutationId: `tpl_${input.resumeId}_${resolved.id}_${Date.now().toString(36)}`,
      resumeId: input.resumeId,
      expectedRevision: input.expectedRevision ?? baseline.revision,
      operations: built.operations,
    },
  );

  switch (outcome.status) {
    case "committed":
      return {
        status: "committed",
        revision: outcome.result.revision,
        versionId: outcome.result.versionId,
        nextContent: outcome.nextContent,
      };
    case "conflict":
      return { status: "conflict", currentRevision: outcome.result.currentRevision };
    case "no_change":
      return { status: "no_change", currentRevision: outcome.result.currentRevision };
    case "rejected":
      return { status: "rejected", code: outcome.result.code };
  }
}
