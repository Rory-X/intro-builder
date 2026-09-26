import type { SQL } from "drizzle-orm";
import type { RunEventEnvelope, RunEventType, RunStatus } from "@intro-builder/shared/types";

import { db } from "@/db";
import { hashValue } from "@intro-builder/shared/utils";
import {
  buildAcquireLeaseStatement,
  buildInsertEventWithSequenceStatement,
  buildProjectMutationEventWithSequenceStatement,
  buildAssertWritableStatement,
  buildAttemptEndLookupStatement,
  buildFinishRunStatement,
  buildFinishToolExecutionStatement,
  buildGetRunByRequestStatement,
  buildGetRunStatement,
  buildInsertRunStatement,
  buildListEventsStatement,
  buildListToolExecutionsStatement,
  buildReleaseLeaseStatement,
  buildRenewLeaseStatement,
  buildRequestCancelStatement,
  buildStartToolExecutionStatement,
  buildUnprojectedMutationsStatement,
} from "./run-store-sql";
import { buildRunEvent, isTerminalRunStatus } from "./events";

/**
 * 运行存储的**编排层**（P04 任务 1）。
 *
 * SQL 在 `run-store-sql.ts`，这里负责把语句串成有语义的操作，并把
 * 「数据库返回 0 行」翻译成业务结论（冲突 / 已取消 / 无权）。
 *
 * 三条贯穿全文的原则：
 * 1. **归属与授权在 SQL 条件里核验**（不是先查后判），避免 TOCTOU。
 * 2. **0 行不等于错误**：可能是「已取消」「租约已被接管」「已经是终态」，
 *    必须区分并给出不同结论。
 * 3. 服务端模块不得进入客户端 bundle（依赖 `@/db`）。
 */

function assertServerRuntime(): void {
  const nodeVersion = (globalThis as { process?: { versions?: { node?: string } } }).process
    ?.versions?.node;
  if (!nodeVersion) {
    throw new Error("lib/ai/run-store 只能在服务端使用：它持有运行存储，不得进入客户端 bundle。");
  }
}
assertServerRuntime();

/**
 * 把数据库返回的时间值归一化为 Date。
 *
 * 不能假定驱动一定给 Date：原样查询列时 postgres.js 可能返回 ISO 字符串。
 * 直接对返回值调 `.getTime()` 会崩（实测 `cancelRequestedAt.getTime is not a function`）。
 */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function firstRow<T>(rows: unknown): T | null {
  if (Array.isArray(rows)) return (rows[0] as T) ?? null;
  if (rows && typeof rows === "object" && "rows" in rows) {
    const inner = (rows as { rows: unknown }).rows;
    if (Array.isArray(inner)) return (inner[0] as T) ?? null;
  }
  return null;
}

function allRows<T>(rows: unknown): T[] {
  if (Array.isArray(rows)) return rows as T[];
  if (rows && typeof rows === "object" && "rows" in rows) {
    const inner = (rows as { rows: unknown }).rows;
    if (Array.isArray(inner)) return inner as T[];
  }
  return [];
}

/**
 * SQL 执行器。
 *
 * 做成可注入的，是为了让**集成测试能在隔离数据库上跑同一套编排逻辑**。
 * 否则测试只能 mock `db.execute` 的返回值 —— 那就完全证明不了租约竞争、
 * sequence 分配、终态唯一这些依赖真实并发的行为。
 */
export type RunStoreExecutor = (statement: SQL) => Promise<unknown>;

let executor: RunStoreExecutor = (statement) => db.execute(statement);

/** 仅供集成测试注入隔离数据库的执行器。生产代码不得调用。 */
export function setRunStoreExecutorForTesting(next: RunStoreExecutor): void {
  executor = next;
}

/** 恢复默认执行器（连接真实 `@/db`）。 */
export function resetRunStoreExecutor(): void {
  executor = (statement) => db.execute(statement);
}

async function execute(statement: SQL): Promise<unknown> {
  return executor(statement);
}

export type DbRun = {
  id: string;
  userId: string;
  resumeId: string;
  sessionId: string | null;
  requestId: string;
  status: RunStatus;
  mode: string;
  writeMode: "direct" | "approval";
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  fenceToken: number;
  cancelRequestedAt: Date | null;
  deadlineAt: Date | null;
  startedAt: Date;
  finishedAt: Date | null;
  checkpointVersion: number;
  checkpoint: Record<string, unknown> | null;
  promptVersion: string | null;
  modelId: string | null;
  usage: Record<string, unknown> | null;
  parentRunId: string | null;
  lastError: string | null;
};

export async function getRun(runId: string): Promise<DbRun | null> {
  const row = firstRow<DbRun>(await execute(buildGetRunStatement(runId)));
  if (!row) return null;
  // 时间字段统一归一化，调用方不必再关心驱动返回的是 Date 还是字符串。
  return {
    ...row,
    leaseExpiresAt: toDate(row.leaseExpiresAt),
    cancelRequestedAt: toDate(row.cancelRequestedAt),
    deadlineAt: toDate(row.deadlineAt),
    startedAt: toDate(row.startedAt) ?? new Date(0),
    finishedAt: toDate(row.finishedAt),
  };
}

export type StartRunOutcome =
  | { status: "created"; runId: string }
  /** 重复的 start 请求：复用已有 Run，不二次调用模型。 */
  | { status: "existing"; runId: string; runStatus: RunStatus };

/**
 * 幂等创建 Run。
 *
 * `ON CONFLICT DO NOTHING` 后**必须重查**：插入返回 0 行意味着「已经存在」，
 * 我们要把已有 Run 的 id 交回调用方（复用），而不是当作失败。
 */
export async function startRun(params: {
  id: string;
  userId: string;
  resumeId: string;
  sessionId: string | null;
  requestId: string;
  mode: string;
  writeMode: "direct" | "approval";
  promptVersion?: string | null;
  modelId?: string | null;
  deadlineAt?: Date | null;
}): Promise<StartRunOutcome> {
  const inserted = firstRow<{ id: string }>(
    await execute(
      buildInsertRunStatement({
        ...params,
        promptVersion: params.promptVersion ?? null,
        modelId: params.modelId ?? null,
        deadlineAt: params.deadlineAt ?? null,
      }),
    ),
  );
  if (inserted) return { status: "created", runId: inserted.id };

  const existing = firstRow<{ id: string; status: RunStatus }>(
    await execute(buildGetRunByRequestStatement(params.userId, params.requestId)),
  );
  if (!existing) {
    // 冲突原因不是 requestId（例如外键失败）。明确报错，不静默重试。
    throw new Error("[run-store] 创建 Run 失败，且未找到同 requestId 的既有 Run");
  }
  return { status: "existing", runId: existing.id, runStatus: existing.status };
}

export type AcquireLeaseOutcome =
  | { status: "acquired"; fenceToken: number; leaseExpiresAt: Date }
  /** 有别人持有有效租约：同一简历同时只允许一个写 Run。 */
  | { status: "held_by_other" }
  /** Run 已处于终态，不可复活。 */
  | { status: "terminal" }
  | { status: "not_found" };

/** 获取写租约。条件 UPDATE 保证并发下只有一个成功。 */
export async function acquireLease(params: {
  runId: string;
  userId: string;
  leaseOwner: string;
  ttlMs: number;
}): Promise<AcquireLeaseOutcome> {
  const leaseExpiresAt = new Date(Date.now() + params.ttlMs);
  const row = firstRow<{ fenceToken: number; leaseExpiresAt: Date }>(
    await execute(
      buildAcquireLeaseStatement({
        runId: params.runId,
        userId: params.userId,
        leaseOwner: params.leaseOwner,
        leaseExpiresAt,
      }),
    ),
  );
  if (row) {
    return {
      status: "acquired",
      fenceToken: row.fenceToken,
      leaseExpiresAt: toDate(row.leaseExpiresAt) ?? leaseExpiresAt,
    };
  }

  // 0 行：区分「别人持有」「已终态」「不存在」—— 三者的正确响应完全不同。
  const run = await getRun(params.runId);
  if (!run || run.userId !== params.userId) return { status: "not_found" };
  if (isTerminalRunStatus(run.status)) return { status: "terminal" };
  return { status: "held_by_other" };
}

/** 续租。失败（0 行）表示租约已被取消、被接管或已终态 —— 调用方应立即停止。 */
export async function renewLease(params: {
  runId: string;
  leaseOwner: string;
  fenceToken: number;
  ttlMs: number;
}): Promise<boolean> {
  const row = firstRow<{ id: string }>(
    await execute(
      buildRenewLeaseStatement({
        runId: params.runId,
        leaseOwner: params.leaseOwner,
        fenceToken: params.fenceToken,
        leaseExpiresAt: new Date(Date.now() + params.ttlMs),
      }),
    ),
  );
  return row !== null;
}

export async function releaseLease(runId: string, fenceToken: number): Promise<void> {
  await execute(buildReleaseLeaseStatement({ runId, fenceToken }));
}

/**
 * 追加事件。
 *
 * sequence 由数据库分配：先读当前最大值再插入。两条语句之间存在竞争窗口，
 * 但 `UNIQUE(runId, sequence)` 会让落败方的插入失败 —— 由调用方重试取值，
 * 而不是靠进程内锁。这样即使多实例并发也不会产生重号。
 */
export async function appendEvent(params: {
  runId: string;
  attemptId: string;
  type: RunEventType;
  payload: Record<string, unknown>;
  eventId: string;
  sourceEventId?: string | null;
  occurredAt?: Date;
  maxAttempts?: number;
}): Promise<RunEventEnvelope> {
  /*
   * sequence 必须在**同一条语句**里分配。
   *
   * 「先读 MAX 再插入」两条语句之间存在竞争窗口。实测 8 路并发时落败方反复重试
   * 仍会耗尽次数，导致事件**直接丢失** —— 丢的可能是 mutation.committed，
   * UI 会因此永远显示「未保存」。改为单语句内子查询 + 对 Run 行加锁，
   * 并发写入自然排队，既不重号也不丢事件，客户端也不需要重试。
   */
  const event = buildRunEvent({
    eventId: params.eventId,
    runId: params.runId,
    attemptId: params.attemptId,
    // 占位值：真实 sequence 由数据库在语句内分配并 RETURNING 回来。
    sequence: 0,
    type: params.type,
    payload: params.payload,
    occurredAt: params.occurredAt,
  });
  // 去掉占位 sequence，真实序号由数据库在语句内分配并 RETURNING 回来。
  const withoutSequence = { ...event } as Omit<typeof event, "sequence">;
  delete (withoutSequence as { sequence?: number }).sequence;
  const row = firstRow<{ sequence: number }>(
    await execute(buildInsertEventWithSequenceStatement(withoutSequence, params.sourceEventId ?? null)),
  );
  if (!row) throw new Error("[run-store] 写入事件失败：数据库未返回 sequence");
  return { ...event, sequence: row.sequence };
}

export async function listEvents(params: {
  runId: string;
  afterSequence?: number;
  limit?: number;
}): Promise<RunEventEnvelope[]> {
  const rows = allRows<{
    eventId: string;
    runId: string;
    attemptId: string;
    sequence: number;
    type: RunEventType;
    payload: Record<string, unknown>;
    occurredAt: Date;
  }>(
    await execute(
      buildListEventsStatement({
        runId: params.runId,
        afterSequence: params.afterSequence ?? 0,
        limit: params.limit ?? 200,
      }),
    ),
  );
  return rows.map((row) => ({
    schemaVersion: 1 as const,
    eventId: row.eventId,
    runId: row.runId,
    attemptId: row.attemptId,
    sequence: row.sequence,
    type: row.type,
    occurredAt: (toDate(row.occurredAt) ?? new Date(0)).toISOString(),
    payload: row.payload,
  }));
}

/** attempt 是否已经给出结束事件（EOF 判定用）。 */
export async function readAttemptEndType(
  runId: string,
  attemptId: string,
): Promise<RunEventType | null> {
  const row = firstRow<{ type: RunEventType }>(
    await execute(buildAttemptEndLookupStatement({ runId, attemptId })),
  );
  return row?.type ?? null;
}

export type FinishRunOutcome =
  | { status: "updated"; runStatus: string }
  /** 已经是终态：终态只能出现一次，本次不生效。 */
  | { status: "already_terminal" };

/**
 * 写入 Run 状态。
 *
 * 0 行表示「Run 已经处于终态」—— 这正是「终态只出现一次」的实现方式。
 * 调用方不应把它当错误，但也不能因此认为自己的结论写在库里了。
 */
export async function finishRun(params: {
  runId: string;
  status: "completed" | "failed" | "cancelled" | "interrupted" | "waiting_user";
  lastError?: string | null;
}): Promise<FinishRunOutcome> {
  const row = firstRow<{ status: string }>(
    await execute(
      buildFinishRunStatement({
        runId: params.runId,
        status: params.status,
        lastError: params.lastError ?? null,
      }),
    ),
  );
  return row ? { status: "updated", runStatus: row.status } : { status: "already_terminal" };
}

/** 持久化取消意图。幂等：重复取消不报错，也不覆盖首次时间。 */
export async function requestCancel(runId: string): Promise<{ runStatus: string } | null> {
  const row = firstRow<{ status: string }>(
    await execute(buildRequestCancelStatement(runId)),
  );
  return row ? { runStatus: row.status } : null;
}

/**
 * 提交前的 fencing 核验。
 *
 * 这是**唯一**能确定「取消与提交谁先」的检查：cancel 与 commit 可能并发，
 * 只有在写库前再核验一次，才能让「取消先成功则禁止提交，提交先成功则取消保留结果」
 * 成立。返回 false 时调用方必须放弃写入。
 */
export async function isRunWritable(runId: string, fenceToken: number): Promise<boolean> {
  const row = firstRow<{ id: string }>(
    await execute(buildAssertWritableStatement({ runId, fenceToken })),
  );
  return row !== null;
}

/** 记录工具开始。返回 false 表示该 (attempt, toolCallId) 已有账目 —— 即重试。 */
export async function startToolExecution(params: {
  id: string;
  runId: string;
  attemptId: string;
  toolCallId: string;
  toolName: string;
  inputHash: string;
}): Promise<boolean> {
  const row = firstRow<{ id: string }>(
    await execute(buildStartToolExecutionStatement(params)),
  );
  return row !== null;
}

export async function finishToolExecution(params: {
  runId: string;
  attemptId: string;
  toolCallId: string;
  status: "succeeded" | "failed" | "interrupted";
  result: Record<string, unknown> | null;
  mutationId?: string | null;
  changeSetId?: string | null;
  errorCode?: string | null;
}): Promise<void> {
  await execute(
    buildFinishToolExecutionStatement({
      ...params,
      mutationId: params.mutationId ?? null,
      changeSetId: params.changeSetId ?? null,
      errorCode: params.errorCode ?? null,
    }),
  );
}

export type ToolExecutionRecord = {
  attemptId: string;
  toolCallId: string;
  toolName: string;
  inputHash: string;
  status: "running" | "succeeded" | "failed" | "interrupted";
  result: Record<string, unknown> | null;
  mutationId: string | null;
  changeSetId: string | null;
  errorCode: string | null;
};

export async function listToolExecutions(runId: string): Promise<ToolExecutionRecord[]> {
  return allRows<ToolExecutionRecord>(
    await execute(buildListToolExecutionsStatement(runId)),
  );
}

/** 工具参数哈希：同一次调用的重试必须命中同一条账目。 */
export function toolInputHash(toolName: string, input: unknown): string {
  return hashValue({ toolName, input });
}

/**
 * 协调遗漏的文档提交事件投影（P04 任务 1）。
 *
 * `resume_mutation_event` 是文档提交的可靠源；`ai_run_event` 是它的展示投影。
 * 投影失败**不能**反过来报告文档提交失败 —— 文档已经原子落盘了。因此读取状态前
 * 先把该 Run 尚未投影的提交事件补齐。
 *
 * 去重由 `UNIQUE(sourceEventId)` 保证，重复调用安全。
 */
export async function reconcileMutationEvents(
  runId: string,
  attemptId: string,
  newEventId: () => string,
): Promise<number> {
  const pending = allRows<{ eventId: string; mutationId: string; payload: unknown }>(
    await execute(buildUnprojectedMutationsStatement(runId)),
  );
  let projected = 0;
  for (const item of pending) {
    try {
      const row = firstRow<{ sequence: number }>(
        await execute(
          buildProjectMutationEventWithSequenceStatement({
            eventId: newEventId(),
            runId,
            attemptId,
            sourceEventId: item.eventId,
            payload:
              item.payload && typeof item.payload === "object"
                ? (item.payload as Record<string, unknown>)
                : { mutationId: item.mutationId },
            occurredAt: new Date().toISOString(),
          }),
        ),
      );
      // 0 行 = 该 sourceEventId 已被投影（唯一键命中），不算本次新增。
      if (row) projected += 1;
    } catch {
      // 单条投影失败不阻塞其余；下次读取会再次尝试（源事件仍未被投影）。
      continue;
    }
  }
  return projected;
}
