"use server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { ResumeContent } from "@intro-builder/shared/schemas";
import { newSlug } from "@intro-builder/shared/utils";
import { withDbRetry } from "@/lib/db-retry";
import {
  getTemplateMetaAsync,
  getTemplateDefaultStyleSettings,
} from "@/lib/templates/registry-server";
import type { TemplateId } from "@/lib/templates/registry";

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

export async function saveResume(id: string, content: unknown, title?: string) {
  const userId = await actionUserId();
  const parsed = ResumeContent.safeParse(content);
  if (!parsed.success) throw new Error("invalid: " + parsed.error.message);
  await withDbRetry("saveResume", () =>
    db.update(resumes)
      .set({
        content: parsed.data,
        ...(title ? { title } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(resumes.id, id), eq(resumes.userId, userId))),
  );
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
