import { sql } from "drizzle-orm";
import { ResumeContent as ResumeContentSchema } from "@intro-builder/shared/schemas";
import { migrateContent } from "@intro-builder/shared/utils";

import { db } from "@/db";
import { assertServerRuntime } from "./server-guard";
import type { WorkspaceSource } from "./workspace";

/**
 * Run 的简历读取（P04 任务 2 的 `loadWorkspaceSource`）。
 *
 * 与 `commit.ts` 的 `readBase` 是同一套语义，刻意保持一致的只有两点：
 *
 * 1. **必须带 `userId` 过滤**。只按 `id` 查会让越权方拿到一个有内容的返回
 *    （而不是空），那等于把「这份简历存在」当作可观测信号泄露出去。
 *    路由据此返回 404 而不是 403。
 * 2. **解析前跑读侧懒迁移**（`migrateContent`）。旧文档的 `bullets` 等旧字段
 *    必须在这里补齐稳定 ID，否则工作副本会缺少身份，后续按 ID 定位全部失败
 *    （P03 修过的「存量文档静默清空」就是这一类）。
 *
 * 单独成模块而不是复用 `readBase`：后者是 `commit.ts` 的私有函数，
 * 且返回类型面向提交（带 `BaseRow` 形状）。让读路径与写路径共享一个私有实现
 * 会把「只想读」的调用方绑上提交模块的全部依赖。
 */

assertServerRuntime("lib/ai/resume-source.ts");

let executor: (statement: ReturnType<typeof sql>) => Promise<unknown> = (statement) =>
  db.execute(statement);

/** 仅供集成测试注入隔离数据库的执行器。生产代码不得调用。 */
export function setResumeSourceExecutorForTesting(next: (statement: never) => Promise<unknown>): void {
  executor = next as (statement: ReturnType<typeof sql>) => Promise<unknown>;
}

/** 恢复默认执行器。 */
export function resetResumeSourceExecutor(): void {
  executor = (statement) => db.execute(statement);
}

function firstRow(rows: unknown): Record<string, unknown> | null {
  if (Array.isArray(rows)) return (rows[0] as Record<string, unknown>) ?? null;
  if (rows && typeof rows === "object" && "rows" in rows) {
    const inner = (rows as { rows: unknown }).rows;
    if (Array.isArray(inner)) return (inner[0] as Record<string, unknown>) ?? null;
  }
  return null;
}

/**
 * 读取运行所需的权威内容。
 *
 * **返回 `null` 表示「不存在或无权访问」**（两者不可区分，调用方一律 404）。
 * 内容不符合当前契约时**抛错**：那是数据问题，不是「找不到」，
 * 静默返回 null 会让用户看到「简历不见了」而客服无从排查。
 */
export async function loadResumeSourceForRun(input: {
  resumeId: string;
  userId: string;
}): Promise<WorkspaceSource | null> {
  const rows = await executor(
    sql`SELECT revision, content, title, "templateId" FROM "resume"
         WHERE id = ${input.resumeId} AND "userId" = ${input.userId} LIMIT 1`,
  );
  const row = firstRow(rows);
  if (!row) return null;

  const parsed = ResumeContentSchema.safeParse(migrateContent(row.content));
  if (!parsed.success) {
    throw new Error(
      `[ai/resume-source] 简历 ${input.resumeId} 的内容不符合当前契约：` +
        `${parsed.error.issues[0]?.message ?? "未知原因"}`,
    );
  }

  return {
    content: parsed.data,
    revision: Number(row.revision),
    title: typeof row.title === "string" ? row.title : "",
    templateId: typeof row.templateId === "string" ? row.templateId : "classic",
  };
}
