import type { RunEventEnvelope, RunStatus } from "@intro-builder/shared/types";

/**
 * 客户端**唯一**的事件 reducer（P04 任务 5）。
 *
 * 它把事件流投影成 UI 需要的状态。三条铁则：
 *
 * 1. **不虚构进度**。没有事件就没有状态变化 —— 不按时间猜测百分比、
 *    不因为「看起来在跑」就把步骤标成已完成。
 * 2. **模型完成 ≠ 修改已保存**。文本生成结束只说明模型说完了；
 *    「已保存」只能由 `mutation.committed` 驱动（与文档提交回执同源）。
 * 3. **按 (runId, sequence) 去重**，业务成功额外按 eventId / mutationId 去重。
 *    重放事件不得重复 toast 或重复应用修改。
 *
 * 本模块是纯函数，可在无网络/无编辑器的情况下穷举测试。
 */

export type ToolCallProjection = {
  toolCallId: string;
  toolName: string;
  status: "running" | "succeeded" | "failed";
  /** 参数片段（仅用于展示，不用于执行）。 */
  partialArguments: string;
  result?: Record<string, unknown>;
  errorCode?: string;
  /** 该工具产生的提案 / 提交关联。 */
  changeSetId?: string;
  mutationId?: string;
};

export type ProposalProjection = {
  changeSetId: string;
  proposalVersion: number;
  summary: string;
  status: "pending" | "committed" | "partially_committed" | "rejected" | "superseded";
  operationCount: number;
};

export type CommittedMutation = {
  mutationId: string;
  revision: number;
  versionId: string;
  changeSetId: string | null;
};

export type RunProjection = {
  runId: string | null;
  status: RunStatus | "idle";
  /** 已见的最大 sequence，用于去重与续读游标。 */
  lastSequence: number;
  /** 流式文本（按批次累加）。 */
  text: string;
  tools: ToolCallProjection[];
  proposals: ProposalProjection[];
  committed: CommittedMutation[];
  /** 等待用户的问题（askUser）。 */
  pendingQuestion: { questionId: string; question: string; target?: string } | null;
  /** 已应用的决策（批准/拒绝），按 changeSetId+version 去重。 */
  decisions: Array<{
    changeSetId: string;
    proposalVersion: number;
    accepted: string[];
    rejected: string[];
  }>;
  /** 冲突（内容被别处修改），需要用户干预。 */
  conflicts: Array<{ mutationId: string; message: string }>;
  /** 结束原因；EOF 缺结束事件时为 interrupted。 */
  endReason: string | null;
  /** 已处理过的事件 id，用于去重。 */
  seenEventIds: string[];
};

export function createRunProjection(): RunProjection {
  return {
    runId: null,
    status: "idle",
    lastSequence: 0,
    text: "",
    tools: [],
    proposals: [],
    committed: [],
    pendingQuestion: null,
    decisions: [],
    conflicts: [],
    endReason: null,
    seenEventIds: [],
  };
}

export type ReduceResult = {
  state: RunProjection;
  /** 本次调用是否真的改变了状态（false = 重复事件，UI 不应做任何反应）。 */
  changed: boolean;
};

/**
 * 应用一个事件。
 *
 * 返回 `changed: false` 时调用方**不得**产生副作用（弹 toast、写文档、滚动）。
 */
export function reduceRunEvent(state: RunProjection, event: RunEventEnvelope): ReduceResult {
  // 去重 1：同一 eventId 重复到达（重放）。
  if (state.seenEventIds.includes(event.eventId)) {
    return { state, changed: false };
  }
  // 去重 2：sequence 不大于已见值（乱序/重复投递）。
  if (event.sequence <= state.lastSequence && state.runId === event.runId) {
    return { state, changed: false };
  }
  // Run 绑定：一个投影只服务一个 Run。
  if (state.runId !== null && state.runId !== event.runId) {
    return { state, changed: false };
  }

  /*
   * 终态保护：`completed` / `failed` / `cancelled` 是**最终**结论，后续事件
   * 不得把它改回去。
   *
   * 服务端 `finishRun` 有「终态只出现一次」的 SQL 保证，reducer 此前没有对应
   * 保护：取消路由会写一条 run.cancelled，而执行中的 attempt 随后写的
   * run.completed（sequence 更大、不触发去重）会把状态改回「已完成」——
   * 用户点了取消，界面先显示已取消，随后跳回已完成。
   *
   * 两端语义必须对称，否则同一份事件流会得出两个结论。
   */
  const TERMINAL = ["completed", "failed", "cancelled"] as const;
  const isTerminalStatus = (status: string): boolean =>
    (TERMINAL as readonly string[]).includes(status);
  const END_EVENT_TYPES = [
    "run.completed",
    "run.failed",
    "run.cancelled",
    "run.waiting_user",
    "run.interrupted",
  ] as const;
  const isEndEvent = (type: string): boolean =>
    (END_EVENT_TYPES as readonly string[]).includes(type);

  if (isTerminalStatus(state.status) && isEndEvent(event.type)) {
    // 已终态：仍记录 sequence（避免重复处理），但不改变结论。
    return {
      state: {
        ...state,
        lastSequence: Math.max(state.lastSequence, event.sequence),
        seenEventIds: [...state.seenEventIds, event.eventId],
      },
      changed: false,
    };
  }

  const next: RunProjection = {
    ...state,
    runId: event.runId,
    lastSequence: Math.max(state.lastSequence, event.sequence),
    seenEventIds: [...state.seenEventIds, event.eventId],
  };

  const payload = event.payload ?? {};

  switch (event.type) {
    case "run.started":
      next.status = "running";
      break;

    case "attempt.started":
      // 新 attempt 不重置历史，只把状态拉回 running。
      next.status = "running";
      next.endReason = null;
      break;

    case "text.delta": {
      const delta = typeof payload.text === "string" ? payload.text : "";
      next.text = state.text + delta;
      break;
    }

    case "tool.started": {
      const toolCallId = String(payload.toolCallId ?? "");
      const toolName = String(payload.toolName ?? "");
      if (!toolCallId) break;
      // 同一 toolCallId 重复开始了就更新，不追加重复条目。
      next.tools = upsertTool(state.tools, {
        toolCallId,
        toolName,
        status: "running",
        partialArguments: "",
      });
      break;
    }

    case "tool.arguments": {
      const toolCallId = String(payload.toolCallId ?? "");
      // 参数片段**仅用于展示**：这里累积它，但绝不据此执行任何操作。
      next.tools = state.tools.map((tool) =>
        tool.toolCallId === toolCallId
          ? { ...tool, partialArguments: tool.partialArguments + String(payload.delta ?? "") }
          : tool,
      );
      break;
    }

    case "tool.succeeded": {
      const toolCallId = String(payload.toolCallId ?? "");
      next.tools = upsertTool(state.tools, {
        toolCallId,
        toolName: String(payload.toolName ?? ""),
        status: "succeeded",
        partialArguments: "",
        result: asRecord(payload.result),
        changeSetId: typeof payload.changeSetId === "string" ? payload.changeSetId : undefined,
        mutationId: typeof payload.mutationId === "string" ? payload.mutationId : undefined,
      });
      break;
    }

    case "tool.failed": {
      const toolCallId = String(payload.toolCallId ?? "");
      next.tools = upsertTool(state.tools, {
        toolCallId,
        toolName: String(payload.toolName ?? ""),
        status: "failed",
        partialArguments: "",
        errorCode: typeof payload.code === "string" ? payload.code : undefined,
      });
      break;
    }

    case "proposal.ready": {
      const changeSetId = String(payload.changeSetId ?? "");
      const proposalVersion = Number(payload.proposalVersion ?? 1);
      if (!changeSetId) break;
      // 同一提案版本重复到达不追加；新版本**替换**旧版本（旧批准随内容变更失效）。
      const existing = next.proposals.findIndex((p) => p.changeSetId === changeSetId);
      const projection: ProposalProjection = {
        changeSetId,
        proposalVersion,
        summary: String(payload.summary ?? ""),
        status: "pending",
        operationCount: Number(payload.operationCount ?? 0),
      };
      if (existing >= 0) {
        next.proposals = next.proposals.map((p, i) => (i === existing ? projection : p));
      } else {
        next.proposals = [...next.proposals, projection];
      }
      break;
    }

    case "decision.recorded": {
      const changeSetId = String(payload.changeSetId ?? "");
      const proposalVersion = Number(payload.proposalVersion ?? 0);
      if (!changeSetId || proposalVersion === 0) break;
      if (
        next.decisions.some(
          (d) => d.changeSetId === changeSetId && d.proposalVersion === proposalVersion,
        )
      ) {
        break;
      }
      next.decisions = [
        ...state.decisions,
        {
          changeSetId,
          proposalVersion,
          accepted: asStringArray(payload.acceptedOperationIds),
          rejected: asStringArray(payload.rejectedOperationIds),
        },
      ];
      break;
    }

    case "mutation.committed": {
      const mutationId = String(payload.mutationId ?? "");
      if (!mutationId) break;
      // 业务级去重：同一 mutationId 只记一次（重放不重复记）。
      if (state.committed.some((c) => c.mutationId === mutationId)) break;
      next.committed = [
        ...state.committed,
        {
          mutationId,
          revision: Number(payload.revision ?? 0),
          versionId: String(payload.versionId ?? ""),
          changeSetId: typeof payload.changeSetId === "string" ? payload.changeSetId : null,
        },
      ];
      // 提案状态随之推进（若这条提交属于某个提案）。
      const changeSetId = typeof payload.changeSetId === "string" ? payload.changeSetId : null;
      if (changeSetId) {
        next.proposals = next.proposals.map((p) =>
          p.changeSetId === changeSetId
            ? {
                ...p,
                status: payload.partiallyCommitted === true ? "partially_committed" : "committed",
              }
            : p,
        );
      }
      break;
    }

    case "mutation.conflict": {
      const mutationId = String(payload.mutationId ?? "");
      // 冲突按 mutationId 去重；不同 mutation 的冲突都要显示。
      if (state.conflicts.some((c) => c.mutationId === mutationId)) break;
      next.conflicts = [
        ...state.conflicts,
        { mutationId, message: String(payload.message ?? "内容已在别处更新") },
      ];
      break;
    }

    case "run.waiting_user": {
      next.status = "waiting_user";
      next.endReason = "waiting_user";
      const question = asRecord(payload.question);
      if (question && typeof question.question === "string") {
        next.pendingQuestion = {
          questionId: String(question.questionId ?? payload.questionId ?? ""),
          question: question.question,
          target: typeof question.target === "string" ? question.target : undefined,
        };
      }
      break;
    }

    case "run.interrupted":
      next.status = "interrupted";
      next.endReason = String(payload.reason ?? "interrupted");
      break;

    case "run.completed":
      next.status = "completed";
      next.endReason = "completed";
      break;

    case "run.failed":
      next.status = "failed";
      next.endReason = String(payload.message ?? "failed");
      break;

    case "run.cancelled":
      next.status = "cancelled";
      next.endReason = "cancelled";
      break;

    default:
      // 未知类型：仍然记录 sequence（避免重复处理），但不改变业务状态。
      break;
  }

  return { state: next, changed: true };
}

/**
 * 批量应用事件，返回最终状态与「哪些事件真正改变了状态」。
 *
 * 恢复时用它重放历史事件：重复投递不会造成重复副作用。
 */
export function reduceRunEvents(
  state: RunProjection,
  events: RunEventEnvelope[],
): { state: RunProjection; appliedCount: number } {
  let current = state;
  let applied = 0;
  for (const event of events) {
    const result = reduceRunEvent(current, event);
    current = result.state;
    if (result.changed) applied += 1;
  }
  return { state: current, appliedCount: applied };
}

/**
 * 流结束（EOF）时的收尾判定。
 *
 * **没有结束事件就是 interrupted** —— 绝不因为「文本看起来说完了」而推断 completed。
 * 这与服务端 `resolveEofOutcome` 的判据一致，避免两端对同一场景给出不同结论。
 */
export function finalizeOnEof(state: RunProjection): RunProjection {
  if (state.status === "completed" || state.status === "failed" || state.status === "cancelled") {
    return state;
  }
  if (state.status === "waiting_user") {
    // 等待用户是 attempt 的正常结束，不是失败。
    return state;
  }
  return { ...state, status: "interrupted", endReason: "连接结束时未收到结束事件" };
}

function upsertTool(
  tools: ToolCallProjection[],
  incoming: ToolCallProjection,
): ToolCallProjection[] {
  const index = tools.findIndex((tool) => tool.toolCallId === incoming.toolCallId);
  if (index < 0) return [...tools, incoming];
  return tools.map((tool, i) => (i === index ? { ...tool, ...incoming } : tool));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
