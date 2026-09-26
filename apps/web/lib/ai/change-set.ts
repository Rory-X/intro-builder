import { sql, type SQL } from "drizzle-orm";
import type { ProposalStatus } from "@intro-builder/shared/types";
import type { SemanticOperation } from "@intro-builder/shared/schemas";

import { db } from "@/db";
import type { ChangeSetExecutor } from "./change-set-executor";
import { assertServerRuntime } from "./server-guard";

/**
 * 提案与决策的持久化（P04 任务 4）。
 *
 * 契约里最容易做错的两点，这里都用机械手段保证：
 *
 * 1. **批准绑定精确版本**。决策表唯一键是 `(changeSetId, proposalVersion)`，
 *    而 `proposalVersion` 只在**内容变更**时递增。所以「先批准 v1、AI 又改了内容
 *    生成 v2、然后应用」这条路径里，v1 的批准不会被 v2 复用。
 * 2. **决策与回执是两件事**。批准只写 `resume_decision`；真正改文档由
 *    `commitResumeMutation` 完成。批准后若发生 revision 冲突，决策记录保留、
 *    而 UI 必须显示「已确认，尚未保存」——不能写成「已批准并应用」。
 */

assertServerRuntime();

export type PersistedProposal = {
  id: string;
  resumeId: string;
  userId: string;
  runId: string | null;
  title: string;
  baseRevision: number;
  proposalVersion: number;
  operations: SemanticOperation[];
  status: ProposalStatus;
  summary: string | null;
};

function firstRow<T>(rows: unknown): T | null {
  if (Array.isArray(rows)) return (rows[0] as T) ?? null;
  if (rows && typeof rows === "object" && "rows" in rows) {
    const inner = (rows as { rows: unknown }).rows;
    if (Array.isArray(inner)) return (inner[0] as T) ?? null;
  }
  return null;
}

let executor: ChangeSetExecutor = (statement) => db.execute(statement);

/** 仅供集成测试注入隔离数据库的执行器。生产代码不得调用。 */
export function setChangeSetExecutorForTesting(next: ChangeSetExecutor): void {
  executor = next;
}

/** 恢复默认执行器（连接真实 `@/db`）。 */
export function resetChangeSetExecutor(): void {
  executor = (statement) => db.execute(statement);
}

async function execute(statement: SQL): Promise<unknown> {
  return executor(statement);
}

/**
 * 保存一个新提案。
 *
 * **版本只在 `operations` 内容真正变化时递增**，状态也只在内容变化时回到
 * `pending`。此前是无条件 `version + 1` + `status = 'pending'`，于是 AI 重新生成
 * 一份逐字节相同的提案也会推版本：已 committed 的提案被打回待确认
 * （用户看到「刚批准的东西又变回待确认」），且旧版本的批准会被
 * `stale_proposal_version` 拒绝。实测可复现。
 */
export function buildUpsertProposalStatement(params: {
  id: string;
  resumeId: string;
  userId: string;
  runId: string | null;
  title: string;
  baseRevision: number;
  operationsJson: string;
  summary: string | null;
}): SQL {
  return sql`
    INSERT INTO "resume_change_set"
      (id, "resumeId", "userId", "runId", title, "baseRevision", "proposalVersion", operations, status, summary)
    VALUES (${params.id}, ${params.resumeId}, ${params.userId}, ${params.runId}, ${params.title},
            ${params.baseRevision}, 1, ${params.operationsJson}::jsonb, 'pending', ${params.summary})
    ON CONFLICT (id) DO UPDATE
       SET "proposalVersion" = CASE
             WHEN "resume_change_set".operations IS DISTINCT FROM ${params.operationsJson}::jsonb
               THEN "resume_change_set"."proposalVersion" + 1
             ELSE "resume_change_set"."proposalVersion"
           END,
           operations = ${params.operationsJson}::jsonb,
           "baseRevision" = ${params.baseRevision},
           status = CASE
             WHEN "resume_change_set".operations IS DISTINCT FROM ${params.operationsJson}::jsonb
               THEN 'pending'
             ELSE "resume_change_set".status
           END,
           summary = ${params.summary},
           "updatedAt" = now()
    RETURNING id, "proposalVersion"
  `;
}

export function buildGetProposalStatement(changeSetId: string): SQL {
  return sql`
    SELECT id, "resumeId", "userId", "runId", title, "baseRevision", "proposalVersion",
           operations, status, summary
      FROM "resume_change_set" WHERE id = ${changeSetId} LIMIT 1
  `;
}

/**
 * 记录决策。
 *
 * 唯一键 `(changeSetId, proposalVersion)` + `ON CONFLICT DO NOTHING`：
 * **同一版本的决策只写一次**。这防止「重复点击批准」产生两条决策记录，
 * 也防止同一版本被批准两次后重复执行操作。
 */
export function buildRecordDecisionStatement(params: {
  id: string;
  changeSetId: string;
  proposalVersion: number;
  acceptedJson: string;
  rejectedJson: string;
  userId: string;
}): SQL {
  return sql`
    INSERT INTO "resume_decision"
      (id, "changeSetId", "proposalVersion", "acceptedOperationIds", "rejectedOperationIds", "userId")
    VALUES (${params.id}, ${params.changeSetId}, ${params.proposalVersion},
            ${params.acceptedJson}::jsonb, ${params.rejectedJson}::jsonb, ${params.userId})
    ON CONFLICT ("changeSetId", "proposalVersion") DO NOTHING
    RETURNING id
  `;
}

export function buildGetDecisionStatement(changeSetId: string, proposalVersion: number): SQL {
  return sql`
    SELECT id, "acceptedOperationIds", "rejectedOperationIds", "createdAt"
      FROM "resume_decision"
     WHERE "changeSetId" = ${changeSetId} AND "proposalVersion" = ${proposalVersion}
     LIMIT 1
  `;
}

/** 更新提案状态（提交成功后调用）。 */
export function buildSetProposalStatusStatement(params: {
  changeSetId: string;
  status: ProposalStatus;
}): SQL {
  return sql`
    UPDATE "resume_change_set" SET status = ${params.status}, "updatedAt" = now()
     WHERE id = ${params.changeSetId}
    RETURNING id, status
  `;
}

// ─── 决策的业务规则 ──────────────────────────────────────────

export type DecisionInput = {
  changeSetId: string;
  /** 客户端提交的提案版本：必须与库中的当前版本一致，否则拒绝。 */
  proposalVersion: number;
  acceptedOperationIds: string[];
  rejectedOperationIds: string[];
};

export type DecisionValidation =
  | { ok: true; accepted: SemanticOperation[]; rejectedIds: string[] }
  | { ok: false; code: string; message: string };

/**
 * 校验一次决策。
 *
 * 四条规则，每条都对应一个真实误用：
 *
 * 1. **版本必须匹配当前提案**。客户端可能基于旧版本做决定（期间 AI 已重新生成），
 *    那样的批准落在已经不存在的内容上。
 * 2. **同一操作不能既接受又拒绝**。
 * 3. **拒绝的操作不会被再次执行**：调用方只能拿 `accepted` 去提交。
 * 4. **依赖关系**：插入了新条目、却拒绝了对该条目的更新 —— 这是允许的
 *    （用户只想要条目，不想要那条更新）；但反过来「拒绝插入、接受它的更新」
 *    会产出指向不存在目标的命令，必须拒绝。
 */
export function validateDecision(
  proposal: PersistedProposal,
  decision: DecisionInput,
): DecisionValidation {
  if (proposal.proposalVersion !== decision.proposalVersion) {
    return {
      ok: false,
      code: "stale_proposal_version",
      message:
        `提案已更新到第 ${proposal.proposalVersion} 版（你看到的是第 ` +
        `${decision.proposalVersion} 版）。请基于最新内容重新确认。`,
    };
  }

  if (proposal.status === "committed" || proposal.status === "rejected") {
    return {
      ok: false,
      code: "proposal_already_decided",
      message: `该提案已处于 ${proposal.status} 状态，不能再决策`,
    };
  }

  const acceptedSet = new Set(decision.acceptedOperationIds);
  const rejectedSet = new Set(decision.rejectedOperationIds);

  const both = [...acceptedSet].filter((id) => rejectedSet.has(id));
  if (both.length > 0) {
    return {
      ok: false,
      code: "operation_both_accepted_and_rejected",
      message: `同一操作不能既接受又拒绝：${both.join("、")}`,
    };
  }

  const known = new Set(proposal.operations.map((op) => op.id));
  const unknown = [...acceptedSet, ...rejectedSet].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "unknown_operation",
      message: `决策引用了不属于该提案的操作：${unknown.join("、")}`,
    };
  }

  const accepted = proposal.operations.filter((op) => acceptedSet.has(op.id));

  // 依赖检查：接受的操作不得依赖被拒绝的操作。
  const insertedButRejected = new Set<string>();
  for (const op of proposal.operations) {
    if (op.kind === "insert_item" && rejectedSet.has(op.id)) {
      insertedButRejected.add(op.itemId);
    }
  }
  for (const op of accepted) {
    if (op.kind === "set_field" && op.target.itemId && insertedButRejected.has(op.target.itemId)) {
      return {
        ok: false,
        code: "dependency_rejected",
        message: `不能接受对新增条目 ${op.target.itemId} 的修改，同时又拒绝创建它`,
      };
    }
    // 重排也会受插入/删除影响：集合一致由提交层再校验一次。
  }

  return { ok: true, accepted, rejectedIds: [...rejectedSet] };
}

/**
 * 决策的**状态语义**。
 *
 * 关键区分：决策成立 ≠ 修改已保存。批准之后若提交冲突，状态是
 * `awaiting_commit`（已确认，尚未保存），而不是 `committed`。
 */
export type DecisionOutcome =
  | { status: "committed"; acceptedCount: number; revision: number }
  | { status: "awaiting_commit"; acceptedCount: number; reason: string }
  | { status: "rejected"; acceptedCount: 0; rejectedCount: number }
  | { status: "partially_committed"; acceptedCount: number; committedCount: number };

export function describeDecisionOutcome(input: {
  acceptedCount: number;
  rejectedCount: number;
  committedCount: number;
  lastCommitStatus: "committed" | "conflict" | "rejected" | "no_change" | null;
  revision?: number;
}): DecisionOutcome {
  // 全部拒绝：明确记为一个终态，不产生提交。
  if (input.acceptedCount === 0 && input.rejectedCount > 0) {
    return { status: "rejected", acceptedCount: 0, rejectedCount: input.rejectedCount };
  }

  if (input.lastCommitStatus === "committed") {
    // 只提交了部分接受的操作 → 如实标记为部分提交，而不是笼统的「已批准」。
    if (input.committedCount < input.acceptedCount) {
      return {
        status: "partially_committed",
        acceptedCount: input.acceptedCount,
        committedCount: input.committedCount,
      };
    }
    return {
      status: "committed",
      acceptedCount: input.acceptedCount,
      revision: input.revision ?? 0,
    };
  }

  if (input.lastCommitStatus === "conflict") {
    /*
     * 用户批准了，但内容在别处被改过 → 决策成立、修改未保存。
     * 返回 `awaiting_commit`，UI 必须显示「已确认，尚未保存：内容冲突」，
     * **不能**显示「已批准并应用」。
     */
    return {
      status: "awaiting_commit",
      acceptedCount: input.acceptedCount,
      reason: "内容已在别处更新，已确认的操作尚未保存",
    };
  }

  if (input.lastCommitStatus === "no_change") {
    return { status: "committed", acceptedCount: input.acceptedCount, revision: input.revision ?? 0 };
  }

  return {
    status: "awaiting_commit",
    acceptedCount: input.acceptedCount,
    reason: "操作未能保存，请重试",
  };
}

// ─── 仓储（供路由调用） ──────────────────────────────────────

export async function getProposal(changeSetId: string): Promise<PersistedProposal | null> {
  const row = firstRow<{
    id: string;
    resumeId: string;
    userId: string;
    runId: string | null;
    title: string;
    baseRevision: number;
    proposalVersion: number;
    operations: unknown;
    status: ProposalStatus;
    summary: string | null;
  }>(await execute(buildGetProposalStatement(changeSetId)));
  if (!row) return null;
  return {
    ...row,
    operations: Array.isArray(row.operations) ? (row.operations as SemanticOperation[]) : [],
  };
}

export async function saveProposal(params: {
  id: string;
  resumeId: string;
  userId: string;
  runId: string | null;
  title: string;
  baseRevision: number;
  operations: SemanticOperation[];
  summary: string | null;
}): Promise<{ id: string; proposalVersion: number }> {
  const row = firstRow<{ id: string; proposalVersion: number }>(
    await execute(
      buildUpsertProposalStatement({
        ...params,
        operationsJson: JSON.stringify(params.operations),
      }),
    ),
  );
  if (!row) throw new Error("[change-set] 保存提案失败");
  return row;
}

export async function recordDecision(params: {
  id: string;
  changeSetId: string;
  proposalVersion: number;
  acceptedOperationIds: string[];
  rejectedOperationIds: string[];
  userId: string;
}): Promise<{ recorded: boolean }> {
  const row = firstRow<{ id: string }>(
    await execute(
      buildRecordDecisionStatement({
        ...params,
        acceptedJson: JSON.stringify(params.acceptedOperationIds),
        rejectedJson: JSON.stringify(params.rejectedOperationIds),
      }),
    ),
  );
  return { recorded: row !== null };
}

export async function getDecision(
  changeSetId: string,
  proposalVersion: number,
): Promise<{ accepted: string[]; rejected: string[] } | null> {
  const row = firstRow<{ acceptedOperationIds: unknown; rejectedOperationIds: unknown }>(
    await execute(buildGetDecisionStatement(changeSetId, proposalVersion)),
  );
  if (!row) return null;
  return {
    accepted: Array.isArray(row.acceptedOperationIds) ? (row.acceptedOperationIds as string[]) : [],
    rejected: Array.isArray(row.rejectedOperationIds) ? (row.rejectedOperationIds as string[]) : [],
  };
}

export async function setProposalStatus(
  changeSetId: string,
  status: ProposalStatus,
): Promise<void> {
  await execute(buildSetProposalStatusStatement({ changeSetId, status }));
}
