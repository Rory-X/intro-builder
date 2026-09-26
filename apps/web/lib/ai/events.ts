import type { RunEventEnvelope, RunEventType } from "@intro-builder/shared/types";

import { hashValue } from "@intro-builder/shared/utils";

/**
 * 运行事件契约（P04）。
 *
 * 事件是**唯一**的进度真相：UI 的每一步（工具开始、文本增量、提交回执、等待用户）
 * 都由事件驱动，而不是从消息数组下标或内存状态推断。
 *
 * 三条不可让步的规则：
 * 1. `sequence` 由**数据库**分配，在同 Run 内跨 attempts 单调递增。
 *    不用客户端数组长度或内存自增代替跨实例顺序。
 * 2. 每个 attempt 只能有**一个**结束结果；Run 的最终终态只能出现一次。
 * 3. EOF 时缺少结束事件 → 判定为 `interrupted`，绝不假装完成。
 */

/** 封闭事件类型集合。新增类型必须同时在这里与 reducer 中处理。 */
export const RUN_EVENT_TYPES = [
  "run.started",
  "attempt.started",
  "text.delta",
  "tool.started",
  "tool.arguments",
  "tool.succeeded",
  "tool.failed",
  "proposal.ready",
  "decision.recorded",
  "mutation.committed",
  "mutation.conflict",
  "run.waiting_user",
  "run.interrupted",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const satisfies readonly RunEventType[];

/** Run 的终态：出现其一之后不可原地复活。 */
export const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled"] as const;

/** attempt 级的结束事件：表示「这次连接结束」，不一定是任务完成。 */
export const ATTEMPT_END_EVENTS = [
  "run.waiting_user",
  "run.interrupted",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const satisfies readonly RunEventType[];

export function isAttemptEndEvent(type: RunEventType): boolean {
  return (ATTEMPT_END_EVENTS as readonly string[]).includes(type);
}

export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/**
 * 构造事件 envelope。
 *
 * `sequence` 必须是**数据库分配**的下一个值，因此这里要求调用方显式传入，
 * 而不是在这里自增 —— 自增会掩盖跨实例的顺序问题。
 */
export function buildRunEvent(input: {
  eventId: string;
  runId: string;
  attemptId: string;
  sequence: number;
  type: RunEventType;
  payload: Record<string, unknown>;
  occurredAt?: Date;
}): RunEventEnvelope {
  return {
    schemaVersion: 1,
    eventId: input.eventId,
    runId: input.runId,
    attemptId: input.attemptId,
    sequence: input.sequence,
    type: input.type,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    payload: input.payload,
  };
}

/**
 * 判断 EOF（连接结束）时该给**已持久化的 Run** 记什么结果。
 *
 * 用途边界（**不是** attempt 的收尾判定）：
 * - 本函数回答：「连接断了，按已落库的状态看，这个 Run 现在该记成什么？」
 *   典型调用场景是**恢复/巡检路径**：进程被平台杀掉后，另一个请求来读状态，
 *   发现没有结束事件，据此把 Run 标为 interrupted。
 * - 它**不**回答：「本次 attempt 最后该发哪种结束事件」—— 那是
 *   `run.ts` 的 `finalizeAttempt` / `finalizeOnInterrupt` 的职责，
 *   因为那里才知道取消、错误、超预算、`finish` 是否到达。
 *
 * 两者共享同一个判据（「没有结束事件 → 不推断为完成」），但输入不同。
 * 恢复路径接线时应调用本函数，而不是另写一份判断。
 */
export function resolveEofOutcome(
  lastKnownStatus: string,
  sawAttemptEndEvent: boolean,
): { status: "interrupted" | "unchanged"; reason: string } {
  if (isTerminalRunStatus(lastKnownStatus)) {
    return { status: "unchanged", reason: `Run 已处于终态 ${lastKnownStatus}` };
  }
  if (sawAttemptEndEvent) {
    return { status: "unchanged", reason: "attempt 已给出结束事件" };
  }
  return {
    status: "interrupted",
    reason: "连接结束时未收到结束事件，按中断处理（不推断为完成）",
  };
}

/**
 * 断言「一个 attempt 只能有一个结束结果」。
 *
 * 由 `run.ts` 在发出结束事件前调用（`asked` 分支已接入）。
 */
export function assertSingleAttemptEnd(existing: string | null, next: RunEventType): void {
  if (existing !== null) {
    throw new Error(
      `attempt 已经以 ${existing} 结束，不能再写入 ${next} —— 每个 attempt 只能有一个结束结果`,
    );
  }
}

/**
 * 幂等键：用于「重复的 start/continue 请求复用同一个 Run / attempt」。
 *
 * 只哈希客户端可控的意图（resume、消息、模式），不含时间戳 ——
 * 否则同一个逻辑请求的重试会算出不同的键，幂等失效。
 */
export function runRequestHash(input: {
  resumeId: string;
  sessionId: string | null;
  message: string;
  mode: string;
  writeMode: string;
}): string {
  return hashValue({
    resumeId: input.resumeId,
    sessionId: input.sessionId,
    message: input.message,
    mode: input.mode,
    writeMode: input.writeMode,
  });
}

/**
 * lease 判定：当前持有者是否仍然有效。
 *
 * 平台硬杀后旧持有者可能「晚到」，此时它的 lease 已过期（或被新持有者接管）。
 * 调用方必须据此拒绝它的写入 —— 数据库 fence 是拦阻晚到提交的唯一保障，
 * 模型侧的 AbortSignal 只是节省资源。
 */
export function isLeaseActive(
  run: {
    leaseOwner: string | null;
    leaseExpiresAt: Date | null;
    status: string;
    cancelRequestedAt?: Date | null;
  },
  owner: string,
  now: Date = new Date(),
): boolean {
  if (run.cancelRequestedAt) return false;
  if (isTerminalRunStatus(run.status)) return false;
  if (!run.leaseOwner || run.leaseOwner !== owner) return false;
  if (!run.leaseExpiresAt) return false;
  return run.leaseExpiresAt.getTime() > now.getTime();
}
