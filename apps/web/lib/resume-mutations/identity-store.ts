import { sql, type SQL } from "drizzle-orm";

import { migrateContent } from "@intro-builder/shared/utils";

/**
 * 条目身份的**持久化 CAS**（P02 任务 3）。
 *
 * P01 只负责「算出补齐 ID 之后应该长什么样」。这里负责把它**原子地**写进库，
 * 并保证并发初始化只有一个赢家。
 *
 * 为什么必须 CAS 且必须幂等重算：
 * - 两个标签页可能同时打开同一份旧简历，各自尝试补齐。CAS（`WHERE revision = ?`）
 *   保证只有一个成功；落败方重新读取赢家的结果，而不是覆盖出自己的第二套 ID。
 * - ID 由 `resumeId + section + index + contentHash` **确定性**派生，所以落败方
 *   重算也会得到与赢家相同的 ID —— 这正是当初不选 `randomUUID` 的原因。
 *
 * 身份初始化**不推进 `revision`**：它没有改变用户的简历内容（文案、顺序、样式都没动），
 * 只是给条目补上内部标识。推进 revision 会让编辑器凭空收到一次「内容已变化」冲突。
 */

export type IdentityCommitParams = {
  resumeId: string;
  userId: string;
  /**
   * 读到的**原始内容**（JSON 字符串）。CAS 条件比对的是它，而不是 revision。
   *
   * 为什么不能用 revision：身份初始化刻意**不推进 revision**（它没有改变用户的
   * 文案/顺序/样式，只是给条目补内部标识；推进会让编辑器凭空收到一次冲突）。
   * 既然 revision 不变，`WHERE revision = ?` 对并发的第二次初始化同样成立，
   * 「只能一个成功」就无从保证。比对原内容才是真正的 CAS：
   * 第一次写入后内容已变，第二次的 `WHERE content = 旧内容` 必然不匹配。
   */
  expectedContentJson: string;
  /** 补齐 ID 后的正文（JSON 字符串）。 */
  nextContentJson: string;
  /** 来源记录：系统初始化不应伪装成用户改写。 */
  sourceDetail: string;
};

/**
 * 身份初始化的 CAS 语句。
 *
 * 只更新 `content`；`revision`、`updatedAt` 之外的行级字段一律不动。
 * 返回被更新的行（0 行表示 CAS 失败，调用方需要重读并重算）。
 */
export function buildIdentityCommitStatement(p: IdentityCommitParams): SQL {
  return sql`
    UPDATE "resume"
       SET content = ${p.nextContentJson}::jsonb,
           "updatedAt" = now()
     WHERE id = ${p.resumeId}
       AND "userId" = ${p.userId}
       AND content = ${p.expectedContentJson}::jsonb
    RETURNING revision, content
  `;
}

/** 读取当前 revision 与正文，用于 CAS 失败后的重读。 */
export function buildIdentityReadStatement(resumeId: string, userId: string): SQL {
  return sql`
    SELECT revision, content FROM "resume"
     WHERE id = ${resumeId} AND "userId" = ${userId} LIMIT 1
  `;
}

/** 身份初始化的结果，供调用方决定是否需要重读。 */
export type InitializeIdentitiesOutcome =
  | { status: "initialized"; assignedCount: number }
  | { status: "already_initialized" }
  | { status: "not_found" }
  /** 期间发生了真实编辑：调用方必须重读，不能覆盖。 */
  | { status: "concurrent_edit" };

export type IdentityStoreDeps = {
  execute: (statement: SQL) => Promise<unknown>;
  now?: () => Date;
};

type IdentityRow = { revision: number; content: unknown };

function firstRow(rows: unknown): IdentityRow | null {
  if (Array.isArray(rows)) return (rows[0] as IdentityRow) ?? null;
  if (rows && typeof rows === "object" && "rows" in rows) {
    const inner = (rows as { rows: unknown }).rows;
    if (Array.isArray(inner)) return (inner[0] as IdentityRow) ?? null;
  }
  return null;
}

/**
 * 在 owner 开始可写会话前，补齐这份简历的条目身份。
 *
 * 调用方的契约（不可省略）：
 * 1. 必须已经完成 `auth()` 与 ownership 校验；
 * 2. **绝不**从公开只读路径调用（`/r/[slug]`、PDF 渲染、模板缩略图）；
 * 3. 返回 `concurrent_edit` 时应当重读简历再决定，不要重试同一份输入。
 *
 * 循环上限为 1 次重读：第二次仍失败就交给调用方，避免在热路径上反复 CAS。
 */
export async function initializeIdentitiesInStore(
  deps: IdentityStoreDeps,
  input: {
    resumeId: string;
    userId: string;
    prepare: (
      content: unknown,
      revision: number,
    ) =>
      | { ok: true; content: unknown; changed: boolean; assignedCount: number }
      | { ok: false; reason: string };
  },
): Promise<InitializeIdentitiesOutcome> {
  const first = firstRow(
    await deps.execute(buildIdentityReadStatement(input.resumeId, input.userId)),
  );
  if (!first) return { status: "not_found" };

  /*
   * **必须先跑读侧懒迁移**，再交给调用方的 prepare。
   *
   * 库里的 `content` 可能是旧格式（v1 用 `experience[].bullets`）。若把原始 jsonb
   * 直接交给 `ResumeContent.parse`，Zod 会把不认识的 `bullets` 剥掉、把缺失的
   * `content` 填成空 doc，随后 CAS 写回库 —— 用户的文案被**静默清空**（实测复现）。
   *
   * 迁移放在编排层而不是各调用方，是因为这是「任何写库路径都必须先做」的前置条件；
   * 放在调用方迟早会有人漏掉。
   */
  const migratedContent = migrateContent(first.content);

  const prepared = input.prepare(migratedContent, first.revision);
  if (!prepared.ok) {
    // 重复 ID 等数据损坏：不自动改名，交给调用方报告。
    throw new Error(`身份初始化被拒绝：${prepared.reason}`);
  }
  if (!prepared.changed) return { status: "already_initialized" };

  const updated = firstRow(
    await deps.execute(
      buildIdentityCommitStatement({
        resumeId: input.resumeId,
        userId: input.userId,
        expectedContentJson: JSON.stringify(first.content),
        nextContentJson: JSON.stringify(prepared.content),
        sourceDetail: "system:initialize_item_identities",
      }),
    ),
  );
  if (updated) return { status: "initialized", assignedCount: prepared.assignedCount };

  // CAS 失败：可能是并发的另一次初始化赢了，也可能是期间发生了真实编辑。
  // 必须**重读**才能区分 —— 这两种情况的正确响应完全不同。
  const reread = firstRow(
    await deps.execute(buildIdentityReadStatement(input.resumeId, input.userId)),
  );
  if (!reread) return { status: "not_found" };

  const rechecked = input.prepare(migrateContent(reread.content), reread.revision);
  if (!rechecked.ok) throw new Error(`身份初始化被拒绝：${rechecked.reason}`);
  // 重读后已经不需要补齐 → 是并发的另一次初始化赢了，采用赢家的结果。
  if (!rechecked.changed) return { status: "already_initialized" };
  // 仍然缺失 ID，但内容已经变了 → 期间有人真实编辑，不能覆盖。
  return { status: "concurrent_edit" };
}
