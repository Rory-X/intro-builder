import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import type { CommitResult, MutationCommand, ResumeContent } from "@intro-builder/shared/schemas";
import { ResumeContent as ResumeContentSchema } from "@intro-builder/shared/schemas";
import { MutationCommand as MutationCommandSchema, hashMutationPayload } from "@intro-builder/shared/schemas";
import { createItemId } from "./item-id";
import { hashValue, migrateContent } from "@intro-builder/shared/utils";
import { prepareMutation, type ResumeRowPatch } from "./prepare";
import {
  buildCommitStatement,
  buildReceiptLookupStatement,
  buildRevisionLookupStatement,
} from "./store";

/**
 * 该模块**只能**在服务端运行。
 *
 * 三道防线，从强到弱：
 * 1. **Next.js 打包器**（主要）：本模块依赖 `@/db` → `postgres` / `pg` 等 Node 内置
 *    模块。一旦被客户端组件引用，`next build` 会直接失败。这是最可靠的拦截。
 * 2. **本运行时守卫**（次要）：判断「是否 Node 运行时」，不是 Node 就抛错，
 *    让误用在一个明确的位置炸掉，而不是等到某次写入才暴露。
 * 3. 调用约定：只有 Server Action / 路由处理器引用本模块。
 *
 * 判据刻意用 `process.versions.node` 而**不是** `window`：jsdom 也提供 `window`，
 * 用 `window` 判断会把所有跑在 jsdom 里的单测（`actions.ts` 的测试）误杀，
 * 而那些测试恰恰是合法的服务端调用。jsdom 运行在 Node 上，因此这里通过。
 */
function assertServerRuntime(): void {
  const nodeVersion = (globalThis as { process?: { versions?: { node?: string } } }).process
    ?.versions?.node;
  if (!nodeVersion) {
    throw new Error(
      "lib/resume-mutations/commit 只能在服务端使用：它持有数据库写入路径，不得进入客户端 bundle。",
    );
  }
}

assertServerRuntime();

/**
 * 文档提交模块的对外入口。
 *
 * 这是**唯一**允许写 `resume.content` 的地方。手动编辑、Agent 工具、润色应用、
 * 版本恢复都必须调这里，否则「已保存」就失去了统一含义。
 *
 * 职责分界：
 * - `prepare.ts` 负责纯计算（校验前置条件、算出新内容与真实前后值）；
 * - 本文件负责：鉴权上下文的来源约束、幂等判定、单条 CTE 落库、冲突分类。
 *
 * 关键约定：
 * - `actor` / `source` **只能**由服务端调用上下文给出，绝不从请求 JSON 读取
 *   （契约 §1：模型返回的 userId/source 都不是授权）。
 * - 只有 `committed` 才代表服务端回执已经落盘。模型 token 结束、前端 setValue、
 *   SSE 关闭都不代表保存成功。
 */

/** 可信调用上下文。由路由/Server Action 在完成 auth() 后构造。 */
export type CommitPrincipal = {
  userId: string;
  /** 展示用名称；仅作留痕，不参与授权。 */
  actorName: string;
  /** 来源。必须来自代码分支，不能来自请求体。 */
  source: "manual" | "agent" | "polish" | "restore" | "template" | "style" | "system" | "collab" | "undo";
  /** 若本次提交属于某个 AI Run，则由服务端填入。 */
  runId?: string | null;
  /**
   * Run 的 fencing 令牌（服务端从可信上下文填入）。
   *
   * 非空时提交语句会核验该 Run 仍可写（fenceToken 匹配、未取消、未终态）。
   * 这是「取消能拦住晚到提交」的唯一实现点 —— 调用方**不能**用「我写之前查过一次」
   * 来替代它，查与写之间的窗口足以让已取消的修改落库。
   */
  fence?: { runId: string; fenceToken: number } | null;
  changeSetId?: string | null;
  changeSetVersion?: number | null;
  decisionId?: string | null;
  undoOf?: string | null;
  summary?: string | null;
};

export type CommitDeps = {
  /** 执行一条参数化 SQL。生产走 `@/db` 的 `execute`；测试注入以便故障注入。 */
  execute: (statement: SQL) => Promise<unknown>;
  newId: () => string;
  /** 当前时间由服务端决定，用于回执。 */
  now: () => Date;
};

export type CommitOutcome =
  | { status: "committed"; result: Extract<CommitResult, { status: "committed" }>; nextContent: unknown; rowPatch: ResumeRowPatch }
  | { status: "conflict"; result: Extract<CommitResult, { status: "conflict" }> }
  | { status: "no_change"; result: Extract<CommitResult, { status: "no_change" }> }
  | { status: "rejected"; result: Extract<CommitResult, { status: "rejected" }> };

function defaultDeps(): CommitDeps {
  return {
    execute: (statement) => db.execute(statement),
    newId: () => createItemId("mut"),
    now: () => new Date(),
  };
}

export type CommitOptions = {
  /** 省略则使用生产依赖。 */
  deps?: Partial<CommitDeps>;
  /** 生成新条目 ID 的能力；由调用方注入以便测试稳定。 */
  newItemId?: () => string;
};

/**
 * 提交一次文档修改。
 *
 * 调用方必须先完成鉴权并构造好 principal。`command` 来自不可信输入，
 * 因此这里**第一件事**是按契约 schema 重新解析。
 */
export async function commitResumeMutation(
  principal: CommitPrincipal,
  command: unknown,
  options: CommitOptions = {},
): Promise<CommitOutcome> {
  const deps = { ...defaultDeps(), ...options.deps };
  const newItemId = options.newItemId ?? (() => createItemId());

  const parsed = MutationCommandSchema.safeParse(command);
  if (!parsed.success) {
    return rejected("invalid_command", parsed.error.issues[0]?.message);
  }
  const cmd = parsed.data as MutationCommand;

  // 幂等键：同 ID 同 payload 必须返回原回执，同 ID 异 payload 必须拒绝。
  const requestHash = hashMutationPayload(cmd);

  const existing = await lookupReceipt(deps, cmd.resumeId, cmd.mutationId, principal.userId);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return rejected(
        "idempotency_key_reuse",
        "同一个 mutationId 被用于不同的修改内容，请求已拒绝",
      );
    }
    return {
      status: "committed",
      result: {
        status: "committed",
        mutationId: cmd.mutationId,
        revision: existing.revision,
        versionId: existing.versionId,
        eventId: existing.eventId ?? "",
        operationIds: existing.operationIds,
        changeSetId: existing.changeSetId,
        committedAt: existing.committedAt,
      },
      nextContent: undefined,
      rowPatch: {},
    };
  }

  // 读基准。这里读的是**权威内容**，不是浏览器上传的副本。
  const base = await readBase(deps, cmd.resumeId, principal.userId);
  if (!base) return rejected("not_found", "简历不存在或无权访问");

  const prepared = prepareMutation({
    content: base.content,
    currentRevision: base.revision,
    expectedRevision: cmd.expectedRevision,
    operations: cmd.operations,
    newItemId,
    resumeRow: { title: base.title, templateId: base.templateId },
  });

  if (!prepared.ok) {
    if (prepared.code === "revision_mismatch") {
      return {
        status: "conflict",
        result: {
          status: "conflict",
          currentRevision: base.revision,
          targets: prepared.targets,
        },
      };
    }
    if (prepared.code === "condition_mismatch") {
      return {
        status: "conflict",
        result: {
          status: "conflict",
          currentRevision: base.revision,
          targets: prepared.targets,
        },
      };
    }
    if (prepared.code === "target_not_found" || prepared.code === "order_mismatch") {
      return {
        status: "conflict",
        result: {
          status: "conflict",
          currentRevision: base.revision,
          targets: prepared.targets,
        },
      };
    }
    return rejected(prepared.code, prepared.message);
  }

  // 零变更不生成空修订：原样重复提交返回 no_change，不写 revision。
  if (!prepared.changed) {
    return {
      status: "no_change",
      result: { status: "no_change", currentRevision: base.revision },
    };
  }

  const nextRevision = base.revision + 1;
  const versionId = deps.newId();
  const eventId = deps.newId();

  const statement = buildCommitStatement({
    resumeId: cmd.resumeId,
    userId: principal.userId,
    expectedRevision: cmd.expectedRevision,
    nextContentJson: JSON.stringify(prepared.nextContent),
    nextRevision,
    nextTitle: prepared.rowPatch.title ?? null,
    nextTemplateId: prepared.rowPatch.templateId ?? null,
    mutationId: cmd.mutationId,
    mutationRowId: deps.newId(),
    requestHash,
    operationIdsJson: JSON.stringify(prepared.orderedOperationIds),
    operationCount: prepared.orderedOperationIds.length,
    beforeJson: JSON.stringify(prepared.changes.map((c) => c.before)),
    afterJson: JSON.stringify(prepared.changes.map((c) => c.after)),
    source: principal.source,
    actorName: principal.actorName,
    summary: principal.summary ?? null,
    undoOf: principal.undoOf ?? null,
    changeSetId: principal.changeSetId ?? cmd.changeSetId ?? null,
    changeSetVersion: principal.changeSetVersion ?? cmd.changeSetVersion ?? null,
    decisionId: principal.decisionId ?? cmd.decisionId ?? null,
    versionId,
    eventId,
    runId: principal.runId ?? null,
    /*
     * Run fencing：属于某个 Run 的提交必须携带该 Run 的 fenceToken，
     * 让数据库在**同一条语句**内核验「仍可写」。非 Run 的写入（编辑器手动编辑、
     * 恢复）没有 fence，走无 FROM 的分支。
     */
    fenceRunId: principal.fence?.runId ?? null,
    fenceToken: principal.fence?.fenceToken ?? null,
  });

  let rows: unknown;
  try {
    rows = await deps.execute(statement);
  } catch (error) {
    // 唯一约束竞争等：用**新语句**重查幂等回执，区分「已经提交」与「冲突」。
    const raced = await lookupReceipt(deps, cmd.resumeId, cmd.mutationId, principal.userId);
    if (raced) {
      if (raced.requestHash !== requestHash) {
        return rejected("idempotency_key_reuse", "同一个 mutationId 被用于不同的修改内容");
      }
      return {
        status: "committed",
        result: {
          status: "committed",
          mutationId: cmd.mutationId,
          revision: raced.revision,
          versionId: raced.versionId,
          eventId: raced.eventId ?? "",
          operationIds: raced.operationIds,
          changeSetId: raced.changeSetId,
          committedAt: raced.committedAt,
        },
        nextContent: undefined,
        rowPatch: {},
      };
    }
    throw error;
  }

  const row = firstRow(rows);
  if (!row) {
    // UPDATE 0 行：并发提交或 revision 已被别人推进。先查回执，再报冲突。
    const raced = await lookupReceipt(deps, cmd.resumeId, cmd.mutationId, principal.userId);
    if (raced && raced.requestHash === requestHash) {
      return {
        status: "committed",
        result: {
          status: "committed",
          mutationId: cmd.mutationId,
          revision: raced.revision,
          versionId: raced.versionId,
          eventId: raced.eventId ?? "",
          operationIds: raced.operationIds,
          changeSetId: raced.changeSetId,
          committedAt: raced.committedAt,
        },
        nextContent: undefined,
        rowPatch: {},
      };
    }
    const current = await readRevision(deps, cmd.resumeId, principal.userId);
    return {
      status: "conflict",
      result: {
        status: "conflict",
        currentRevision: current ?? base.revision,
        targets: prepared.changedTargets,
      },
    };
  }

  return {
    status: "committed",
    result: {
      status: "committed",
      mutationId: cmd.mutationId,
      revision: row.revision,
      versionId: row.version_id,
      eventId: row.event_id,
      operationIds: prepared.orderedOperationIds,
      changeSetId: principal.changeSetId ?? cmd.changeSetId ?? null,
      committedAt: deps.now().toISOString(),
    },
    nextContent: prepared.nextContent,
    rowPatch: prepared.rowPatch,
  };
}

function rejected(code: string, message?: string): CommitOutcome {
  return { status: "rejected", result: { status: "rejected", code: message ? `${code}:${message}` : code } };
}

type ReceiptRow = {
  requestHash: string;
  revision: number;
  versionId: string;
  eventId: string | null;
  operationIds: string[];
  changeSetId: string | null;
  committedAt: string;
};

async function lookupReceipt(
  deps: CommitDeps,
  resumeId: string,
  mutationId: string,
  /**
   * 提交者的 userId。回执查询早于 ownership 校验，必须在这里限定归属，
   * 否则越权者凭 resumeId + mutationId 就能读到他人回执（实测可复现）。
   */
  userId: string,
): Promise<ReceiptRow | null> {
  const rows = await deps.execute(buildReceiptLookupStatement(resumeId, mutationId, userId));
  const row = firstRow(rows) as
    | {
        requestHash: string;
        revision: number;
        versionId: string;
        eventId: string | null;
        operationIds: unknown;
        changeSetId: string | null;
        createdAt: unknown;
      }
    | null;
  if (!row) return null;
  return {
    requestHash: row.requestHash,
    revision: row.revision,
    versionId: row.versionId,
    eventId: row.eventId,
    operationIds: Array.isArray(row.operationIds) ? (row.operationIds as string[]) : [],
    changeSetId: row.changeSetId,
    committedAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ""),
  };
}

type BaseRow = {
  revision: number;
  content: ResumeContent;
  title: string;
  templateId: string;
};

/**
 * 读取权威基准内容。
 *
 * `jsonb` 列在类型上只是 `unknown`，所以必须**用内容契约解析一次**再交给 prepare。
 * 不能直接把库里的值当成 `ResumeContent`：历史行可能形状过旧，而 prepare 的结果会被
 * 写回库 —— 未经校验的透传会把一次普通写操作变成数据损坏。
 *
 * 解析前先跑读侧懒迁移（`migrateContent`），让旧文档也符合当前契约。
 */
async function readBase(
  deps: CommitDeps,
  resumeId: string,
  userId: string,
): Promise<BaseRow | null> {
  // 必须带 userId 过滤：只按 id 查会让越权方拿到 conflict（说明简历存在）而不是
  // 「不存在」，等于把「这份简历存在」当作可观测信号泄露出去。
  const rows = await deps.execute(
    sql`SELECT revision, content, title, "templateId" FROM "resume"
         WHERE id = ${resumeId} AND "userId" = ${userId} LIMIT 1`,
  );
  const row = firstRow(rows) as
    | { revision: number; content: unknown; title: string; templateId: string }
    | null;
  if (!row) return null;

  const parsed = ResumeContentSchema.safeParse(migrateContent(row.content));
  if (!parsed.success) {
    throw new Error(
      `[commit] 简历 ${resumeId} 的内容不符合当前契约，已拒绝写入：` +
        `${parsed.error.issues[0]?.message ?? "未知原因"}`,
    );
  }
  return {
    revision: row.revision,
    content: parsed.data,
    title: row.title,
    templateId: row.templateId,
  };
}

async function readRevision(
  deps: CommitDeps,
  resumeId: string,
  userId: string,
): Promise<number | null> {
  const rows = await deps.execute(buildRevisionLookupStatement(resumeId, userId));
  const row = firstRow(rows) as { revision: number } | null;
  return row?.revision ?? null;
}

/** drizzle 的 postgres-js / neon-http 驱动返回的都是数组；这里统一取第一行。 */
function firstRow(rows: unknown): CommitSqlRowLike | null {
  if (Array.isArray(rows)) return (rows[0] as CommitSqlRowLike) ?? null;
  if (rows && typeof rows === "object" && "rows" in rows) {
    const inner = (rows as { rows: unknown }).rows;
    if (Array.isArray(inner)) return (inner[0] as CommitSqlRowLike) ?? null;
  }
  return null;
}

type CommitSqlRowLike = {
  revision: number;
  version_id: string;
  event_id: string;
};

/** 请求规范化哈希。导出以便路由层构造幂等键时复用同一算法。 */
export function mutationRequestHash(command: MutationCommand): string {
  return hashMutationPayload(command);
}

/** 兼容导出：内容哈希工具。 */
export { hashValue };

// ─── 全量恢复（P03 任务 5） ──────────────────────────────────

export type RestoreCommand = {
  mutationId: string;
  resumeId: string;
  expectedRevision: number;
  /** 目标内容（历史版本）。 */
  targetContent: ResumeContent;
  targetTitle: string;
  targetTemplateId: string;
  /** 恢复来源版本，写入留痕便于追溯「从哪一版恢复的」。 */
  restoreFromVersionId: string;
};

/**
 * 以一次**原子提交**把简历恢复到历史版本。
 *
 * 为什么不复用 `commitResumeMutation` 的逐字段差量：恢复的语义是「整份内容变成
 * 历史版本」。若把它拆成逐字段操作，在同字段被并发修改时会产出「一部分字段恢复、
 * 一部分保留」的中间状态 —— 用户看到的是既不是现在的、也不是历史的第三份内容。
 * 全量还原是一个不可分割的用户意图。
 *
 * 仍然完全走同一条 CTE：CAS 更新 + 修订快照 + 回执 + outbox，因此：
 * - 恢复也受 revision 保护（并发第二次恢复会冲突）；
 * - 恢复本身留痕，可以再被撤销/再恢复；
 * - 恢复前的内容由修订快照保留下来（`resume_version` 记录的是提交**后**的快照，
 *   而前一份快照已经在上一修订里，链条完整）。
 */
export async function commitResumeRestore(
  principal: CommitPrincipal,
  command: RestoreCommand,
  options: CommitOptions = {},
): Promise<CommitOutcome> {
  const deps = { ...defaultDeps(), ...options.deps };

  const existing = await lookupReceipt(deps, command.resumeId, command.mutationId, principal.userId);
  const requestHash = hashValue({
    resumeId: command.resumeId,
    expectedRevision: command.expectedRevision,
    restoreFromVersionId: command.restoreFromVersionId,
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return rejected("idempotency_key_reuse", "同一个 mutationId 被用于不同的恢复目标");
    }
    return {
      status: "committed",
      result: {
        status: "committed",
        mutationId: command.mutationId,
        revision: existing.revision,
        versionId: existing.versionId,
        eventId: existing.eventId ?? "",
        operationIds: [],
        changeSetId: existing.changeSetId,
        committedAt: existing.committedAt,
      },
      nextContent: undefined,
      rowPatch: {},
    };
  }

  const base = await readBase(deps, command.resumeId, principal.userId);
  if (!base) return rejected("not_found", "简历不存在或无权访问");

  if (base.revision !== command.expectedRevision) {
    return {
      status: "conflict",
      result: { status: "conflict", currentRevision: base.revision, targets: [] },
    };
  }

  // 恢复到与当前完全相同的内容 → 无变化，不生成空修订。
  const sameContent = hashValue(base.content) === hashValue(command.targetContent);
  const sameRow =
    base.title === command.targetTitle && base.templateId === command.targetTemplateId;
  if (sameContent && sameRow) {
    return {
      status: "no_change",
      result: { status: "no_change", currentRevision: base.revision },
    };
  }

  const nextRevision = base.revision + 1;
  const versionId = deps.newId();
  const eventId = deps.newId();
  const operationId = `restore:${command.restoreFromVersionId}`;

  const statement = buildCommitStatement({
    resumeId: command.resumeId,
    userId: principal.userId,
    expectedRevision: command.expectedRevision,
    nextContentJson: JSON.stringify(command.targetContent),
    nextRevision,
    nextTitle: command.targetTitle,
    nextTemplateId: command.targetTemplateId,
    mutationId: command.mutationId,
    mutationRowId: deps.newId(),
    requestHash,
    operationIdsJson: JSON.stringify([operationId]),
    operationCount: 1,
    beforeJson: JSON.stringify([base.content]),
    afterJson: JSON.stringify([command.targetContent]),
    source: principal.source,
    actorName: principal.actorName,
    summary: principal.summary ?? null,
    undoOf: principal.undoOf ?? null,
    changeSetId: principal.changeSetId ?? null,
    changeSetVersion: principal.changeSetVersion ?? null,
    decisionId: principal.decisionId ?? null,
    versionId,
    eventId,
    runId: principal.runId ?? null,
    /*
     * Run fencing：属于某个 Run 的提交必须携带该 Run 的 fenceToken，
     * 让数据库在**同一条语句**内核验「仍可写」。非 Run 的写入（编辑器手动编辑、
     * 恢复）没有 fence，走无 FROM 的分支。
     */
    fenceRunId: principal.fence?.runId ?? null,
    fenceToken: principal.fence?.fenceToken ?? null,
  });

  let rows: unknown;
  try {
    rows = await deps.execute(statement);
  } catch (error) {
    const raced = await lookupReceipt(deps, command.resumeId, command.mutationId, principal.userId);
    if (raced && raced.requestHash === requestHash) {
      return {
        status: "committed",
        result: {
          status: "committed",
          mutationId: command.mutationId,
          revision: raced.revision,
          versionId: raced.versionId,
          eventId: raced.eventId ?? "",
          operationIds: [operationId],
          changeSetId: raced.changeSetId,
          committedAt: raced.committedAt,
        },
        nextContent: undefined,
        rowPatch: {},
      };
    }
    throw error;
  }

  const row = firstRow(rows);
  if (!row) {
    const current = await readRevision(deps, command.resumeId, principal.userId);
    return {
      status: "conflict",
      result: { status: "conflict", currentRevision: current ?? base.revision, targets: [] },
    };
  }

  return {
    status: "committed",
    result: {
      status: "committed",
      mutationId: command.mutationId,
      revision: row.revision,
      versionId: row.version_id,
      eventId: row.event_id,
      operationIds: [operationId],
      changeSetId: principal.changeSetId ?? null,
      committedAt: deps.now().toISOString(),
    },
    nextContent: command.targetContent,
    rowPatch: { title: command.targetTitle, templateId: command.targetTemplateId },
  };
}
