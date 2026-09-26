/**
 * 运行事件契约（浏览器与服务端共用）。
 *
 * 见 docs/superpowers/specs/2026-09-26-nextjs-agent-contracts.md §5。
 * 这些类型必须与 `apps/web/lib/ai/events.ts` 的运行时集合保持一致 ——
 * 两边不同步会让客户端 reducer 收到它不认识的事件类型。
 */

/** 封闭事件类型。新增类型必须同时更新服务端集合与客户端 reducer。 */
export type RunEventType =
  | "run.started"
  | "attempt.started"
  | "text.delta"
  | "tool.started"
  | "tool.arguments"
  | "tool.succeeded"
  | "tool.failed"
  | "proposal.ready"
  | "decision.recorded"
  | "mutation.committed"
  | "mutation.conflict"
  | "run.waiting_user"
  | "run.interrupted"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

/**
 * 事件 envelope。
 *
 * `sequence` 由数据库分配，在同 Run 内跨 attempts 单调递增；客户端以
 * `(runId, sequence)` 去重。业务成功额外以 `eventId` / `mutationId` 去重。
 */
export type RunEventEnvelope = {
  schemaVersion: 1;
  eventId: string;
  runId: string;
  attemptId: string;
  sequence: number;
  type: RunEventType;
  occurredAt: string;
  payload: Record<string, unknown>;
};

/** Run 状态。前三个是终态，不可复活。 */
export type RunStatus =
  | "running"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

/** 提案状态。任何内容变更都会让 proposalVersion 增加，旧审批随之失效。 */
export type ProposalStatus =
  | "draft"
  | "pending"
  | "partially_committed"
  | "committed"
  | "rejected"
  | "superseded";

/** 写入状态。模型 token 结束不能直接把写入标为成功。 */
export type WriteStatus = "pending" | "committed" | "conflict" | "rejected";
