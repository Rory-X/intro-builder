import type { RunEventType } from "@intro-builder/shared/types";

/**
 * SDK 流 → 业务事件的适配器（P04 任务 5）。
 *
 * AI SDK 的 `fullStream` 发出的是**协议级**片段（text-delta、tool-call、finish……），
 * 而 UI 需要的是**业务事件**（`tool.started`、`mutation.committed`……）。
 * 二者之间必须有且只有一个转换点，否则每个消费方都会自己解释一遍协议，
 * 迟早出现「同一个流在两个地方得出不同结论」。
 *
 * 三条不变量：
 *
 * 1. **参数片段只用于展示**。`tool-call-delta` 累积出来的 JSON 可能永远不完整，
 *    绝不据此执行任何操作；只有完整参数到达并通过 schema 校验后才执行。
 * 2. **一次工具调用只开始一次**。同一个 `toolCallId` 的多个 delta 不产生重复的
 *    `tool.started`，否则 UI 会显示重复卡片。
 * 3. **结束事件必须显式**。流结束（无论正常还是异常）都产出**一个** attempt 结束
 *    事件；异常时是 `run.failed`，被取消时是 `run.cancelled`，正常完成是
 *    `run.completed`。绝不因为「没有更多片段了」就推断完成。
 *
 * 本模块是纯函数（输入片段 → 输出业务事件），因此可以穷举测试。
 */

/** SDK 流片段的**最小**结构。只声明我们真正读取的字段，避免耦合 SDK 内部形状。 */
export type SdkStreamPart =
  | { type: "start" }
  | { type: "text-start"; id?: string }
  | { type: "text-delta"; id?: string; text?: string }
  | { type: "text-end"; id?: string }
  | { type: "reasoning-delta"; text?: string }
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; inputTextDelta?: string }
  | { type: "tool-input-end"; toolCallId: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input?: unknown }
  | { type: "tool-result"; toolCallId: string; toolName?: string; output?: unknown }
  | { type: "tool-error"; toolCallId: string; toolName?: string; error?: unknown }
  | { type: "finish"; finishReason?: string }
  | { type: "error"; error?: unknown }
  | { type: string; [key: string]: unknown };

export type BusinessEventDraft = {
  type: RunEventType;
  payload: Record<string, unknown>;
};

export type StreamAdapterOptions = {
  /** 是否已被取消：决定结束事件是 cancelled 还是 completed/failed。 */
  isCancelled?: () => boolean;
  /** 本轮是否产生了 written 提案（用于区分「完成」与「等待用户」）。 */
  shouldWaitForUser?: () => boolean;
};

/**
 * 把一段 SDK 片段转换成业务事件（0 个或多个）。
 *
 * 返回空数组是合法的（例如 `text-start` 没有对应的业务事件）。
 */
export function adaptStreamPart(
  part: SdkStreamPart,
  state: { startedTools: Set<string> },
): BusinessEventDraft[] {
  switch (part.type) {
    case "start":
      return [];

    case "text-start":
    case "text-end":
      // 文本边界不产生业务事件：UI 只关心增量内容。
      return [];

    case "reasoning-delta":
      // 推理内容**不**进入业务事件流：它不面向用户，也不应被持久化。
      return [];

    case "text-delta": {
      const text = typeof part.text === "string" ? part.text : "";
      if (!text) return [];
      return [{ type: "text.delta", payload: { text, id: part.id } }];
    }

    case "tool-input-start": {
      const toolCallId = String(part.toolCallId ?? "");
      if (!toolCallId) return [];
      // 去重：同一个 toolCallId 只开始一次。
      if (state.startedTools.has(toolCallId)) return [];
      state.startedTools.add(toolCallId);
      return [
        {
          type: "tool.started",
          payload: { toolCallId, toolName: String(part.toolName ?? "") },
        },
      ];
    }

    case "tool-input-delta": {
      const toolCallId = String(part.toolCallId ?? "");
      const delta = typeof part.inputTextDelta === "string" ? part.inputTextDelta : "";
      if (!toolCallId || !delta) return [];
      // 仅用于展示；不参与执行。
      return [{ type: "tool.arguments", payload: { toolCallId, delta } }];
    }

    case "tool-input-end":
      return [];

    case "tool-call": {
      /*
       * 完整参数到达。这里**不**执行工具 —— 执行由 run 编排层负责，
       * 因为它需要 workspace、提交模块、fence 校验等本模块不该知道的依赖。
       * 适配器只负责「让 UI 知道参数已完整」，避免展示半截 JSON 当成结果。
       */
      const toolCallId = String(part.toolCallId ?? "");
      if (!toolCallId) return [];
      return [
        {
          type: "tool.arguments",
          payload: { toolCallId, complete: true, input: part.input },
        },
      ];
    }

    case "tool-result": {
      const toolCallId = String(part.toolCallId ?? "");
      if (!toolCallId) return [];
      const output = asRecord(part.output);
      return [
        {
          type: "tool.succeeded",
          payload: {
            toolCallId,
            toolName: String(part.toolName ?? ""),
            result: output,
            // 与文档提交的关联从工具结果里透出（若工具做了提交）。
            mutationId: typeof output?.mutationId === "string" ? output.mutationId : undefined,
            changeSetId: typeof output?.changeSetId === "string" ? output.changeSetId : undefined,
          },
        },
      ];
    }

    case "tool-error": {
      const toolCallId = String(part.toolCallId ?? "");
      if (!toolCallId) return [];
      return [
        {
          type: "tool.failed",
          payload: {
            toolCallId,
            toolName: String(part.toolName ?? ""),
            code: errorCodeOf(part.error),
          },
        },
      ];
    }

    case "finish":
      // **不**在这里产出结束事件：finish 只表示模型这一步说完了，
      // 而「工具执行 / 提交」可能还在进行。结束事件由 finalizeAttempt 统一给出。
      return [];

    case "error": {
      return [
        {
          type: "run.failed",
          payload: { code: errorCodeOf(part.error), message: errorMessageOf(part.error) },
        },
      ];
    }

    default:
      // 未知片段类型：忽略，不猜测语义。
      return [];
  }
}

/**
 * 一次 attempt 的结束事件。
 *
 * 判据顺序很重要：**取消优先**。若用户在流结束前点了取消，即使模型正常说完了，
 * 结论也必须是 cancelled —— 否则「点了取消，界面却显示完成」。
 */
export function finalizeAttempt(
  options: StreamAdapterOptions & { sawError?: { code: string; message: string } | null } = {},
): BusinessEventDraft {
  if (options.isCancelled?.()) {
    return { type: "run.cancelled", payload: { reason: "用户取消" } };
  }
  if (options.sawError) {
    return {
      type: "run.failed",
      payload: { code: options.sawError.code, message: options.sawError.message },
    };
  }
  if (options.shouldWaitForUser?.()) {
    return { type: "run.waiting_user", payload: {} };
  }
  return { type: "run.completed", payload: {} };
}

/**
 * 连接异常中断时的结束事件。
 *
 * 与 `finalizeAttempt` 分开，是因为「我们主动走完了流程」与「连接断了」是
 * 两种不同的事实。后者一律 `interrupted`，除非已经取消或已经失败。
 */
export function finalizeOnInterrupt(
  options: StreamAdapterOptions & { sawError?: { code: string; message: string } | null } = {},
): BusinessEventDraft {
  if (options.isCancelled?.()) {
    return { type: "run.cancelled", payload: { reason: "用户取消" } };
  }
  if (options.sawError) {
    return {
      type: "run.failed",
      payload: { code: options.sawError.code, message: options.sawError.message },
    };
  }
  return {
    type: "run.interrupted",
    payload: { reason: "连接中断，未收到结束信号" },
  };
}

/**
 * 判断一个 draft 是否是 attempt 结束事件。
 *
 * 调用方用它决定「是否还需要补一个结束事件」—— 一个 attempt 只能有一个结束结果。
 */
export function isAttemptEndDraft(draft: BusinessEventDraft): boolean {
  return (
    draft.type === "run.waiting_user" ||
    draft.type === "run.interrupted" ||
    draft.type === "run.completed" ||
    draft.type === "run.failed" ||
    draft.type === "run.cancelled"
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name) return name;
  }
  return "unknown_error";
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "模型调用失败";
}
