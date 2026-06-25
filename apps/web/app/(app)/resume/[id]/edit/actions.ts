"use server";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumeVersions, resumes } from "@/db/schema";
import { ResumeContent } from "@intro-builder/shared/schemas";
import { newSlug } from "@intro-builder/shared/utils";
import { withDbRetry } from "@/lib/db-retry";
import {
  getTemplateMetaAsync,
  getTemplateDefaultStyleSettings,
} from "@/lib/templates/registry-server";
import type { TemplateId } from "@/lib/templates/registry";

type ResumeVersionSource = "manual" | "agent" | "restore";

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

function sourceLabel(source: ResumeVersionSource): string {
  if (source === "agent") return "通过对话";
  if (source === "restore") return "手动恢复";
  return "手动保存";
}

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

export async function restoreResumeVersion(resumeId: string, versionId: string) {
  const user = await actionUser();
  const rows = await withDbRetry("restoreResumeVersion.read", () =>
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
  const currentRows = await withDbRetry("restoreResumeVersion.current", () =>
    db
      .select({
        title: resumes.title,
        templateId: resumes.templateId,
        content: resumes.content,
      })
      .from(resumes)
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, user.id)))
      .limit(1),
  );
  const currentResume = currentRows[0];
  if (!currentResume) throw new Error("not found");
  const parsedCurrent = ResumeContent.safeParse(currentResume.content);
  if (!parsedCurrent.success) throw new Error("invalid: " + parsedCurrent.error.message);

  await withDbRetry("restoreResumeVersion.version", () =>
    db.insert(resumeVersions).values({
      resumeId,
      userId: user.id,
      title: currentResume.title,
      templateId: currentResume.templateId,
      content: parsedCurrent.data,
      source: "restore",
      actorName: user.name,
      operationCount: 1,
      summary: "恢复历史版本前自动备份",
      parentVersionId: versionId,
    }),
  );
  await withDbRetry("restoreResumeVersion.write", () =>
    db
      .update(resumes)
      .set({
        title: version.title,
        templateId: version.templateId,
        content: parsed.data,
        updatedAt: new Date(),
      })
      .where(and(eq(resumes.id, resumeId), eq(resumes.userId, user.id))),
  );

  return {
    title: version.title,
    templateId: version.templateId,
    content: parsed.data,
  };
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
