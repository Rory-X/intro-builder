import type { RunEventEnvelope, RunEventType } from "@intro-builder/shared/types";

/**
 * 把统一 Run 事件翻译成 panel 已经在消费的 AG-UI 事件。
 *
 * panel 的界面（assistant-ui + AG-UI）不改。改的是执行位置：
 * 不再把流指向独立 Agent 服务，而是吃 Next.js Run 的事件。
 *
 * 两条不能让的约束：
 *
 * 1. **不把提案操作再交给客户端重放。** 统一 Run 在直接模式下已经
 *    由服务端落盘。`TOOL_CALL_RESULT` 里若再带 `proposedOperations`，
 *    panel 会走旧的 `applyOperation` → 又写一次库。
 * 2. **落盘事实用 `CUSTOM` 事件带出去**，不伪装成「待确认修改」。
 *    调用方拿到 revision 后去拉服务端内容并同步表单。
 */

const RUN_EVENT_TYPES = new Set<RunEventType>([
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
]);

export type AgUiWireEvent = { type: string; [key: string]: unknown };

export type AgUiAdaptState = {
  threadId: string;
  runId: string;
  textMessageId: string | null;
  ended: boolean;
};

export type PanelCommitReceipt = {
  mutationId: string;
  revision: number;
  changeSetId: string | null;
};

export function createAgUiAdaptState(input: {
  threadId: string;
  runId: string;
}): AgUiAdaptState {
  return {
    threadId: input.threadId,
    runId: input.runId,
    textMessageId: null,
    ended: false,
  };
}

export function agUiRunStarted(state: AgUiAdaptState): AgUiWireEvent[] {
  return [{ type: "RUN_STARTED", threadId: state.threadId, runId: state.runId }];
}

export function adaptRunEventToAgUi(
  event: RunEventEnvelope,
  state: AgUiAdaptState,
): AgUiWireEvent[] {
  const payload = event.payload ?? {};
  switch (event.type) {
    case "run.started":
    case "attempt.started":
    case "decision.recorded":
      return [];

    case "text.delta": {
      const delta = readString(payload.text);
      if (!delta) return [];
      const opened = openText(state, event.eventId);
      const messageId = state.textMessageId;
      if (!messageId) return opened;
      return [...opened, { type: "TEXT_MESSAGE_CONTENT", messageId, delta }];
    }

    case "tool.started": {
      const toolCallId = readString(payload.toolCallId);
      if (!toolCallId) return [];
      return [
        ...closeText(state),
        {
          type: "TOOL_CALL_START",
          toolCallId,
          toolCallName: readString(payload.toolName) || "tool",
        },
      ];
    }

    case "tool.arguments": {
      const toolCallId = readString(payload.toolCallId);
      if (!toolCallId) return [];
      const delta = readArgumentDelta(payload);
      if (!delta) return [];
      return [{ type: "TOOL_CALL_ARGS", toolCallId, delta }];
    }

    case "tool.succeeded":
      return finishTool(state, payload, "completed");

    case "tool.failed":
      return finishTool(state, payload, "error");

    case "proposal.ready":
      return [
        {
          type: "CUSTOM",
          name: "proposal.ready",
          value: {
            changeSetId: readString(payload.changeSetId) || null,
            proposalVersion:
              typeof payload.proposalVersion === "number" ? payload.proposalVersion : null,
            summary: readString(payload.summary),
            operationCount:
              typeof payload.operationCount === "number" ? payload.operationCount : 0,
          },
        },
      ];

    case "mutation.committed":
      return [mutationCommittedEvent(payload)];

    case "mutation.conflict":
      return finishWithError(
        state,
        readString(payload.message) || "简历已在别处更新，请刷新后重试",
      );

    case "run.waiting_user":
      return waitingUser(state, event.eventId, readString(payload.question));

    case "run.failed":
      return finishWithError(state, readString(payload.message) || "执行失败");

    case "run.completed":
    case "run.cancelled":
    case "run.interrupted":
      return finishOk(state);

    default:
      return [];
  }
}

/** 流结束时补上尚未发出的终态，避免 panel 一直停在「生成中」。 */
export function closeAgUiRun(state: AgUiAdaptState): AgUiWireEvent[] {
  if (state.ended) return closeText(state);
  return finishOk(state);
}

export function readMutationCommitted(event: {
  type?: unknown;
  name?: unknown;
  value?: unknown;
}): PanelCommitReceipt | null {
  if (event.type !== "CUSTOM" || event.name !== "mutation.committed") return null;
  if (!event.value || typeof event.value !== "object" || Array.isArray(event.value)) {
    return null;
  }
  const value = event.value as Record<string, unknown>;
  const mutationId = readString(value.mutationId);
  const revision = value.revision;
  if (!mutationId) return null;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    return null;
  }
  const changeSetId = readString(value.changeSetId);
  return { mutationId, revision, changeSetId: changeSetId || null };
}

export function encodeAgUiSse(events: readonly AgUiWireEvent[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

/**
 * 把统一 Run 的 SSE 响应转成 AG-UI SSE。
 *
 * 先发 `RUN_STARTED`，再逐条翻译，流结束时若还没有终态就补 `RUN_FINISHED`。
 */
export function translateRunSseResponse(
  response: Response,
  identity: { threadId: string; runId: string },
): Response {
  if (!response.body) return response;
  const state = createAgUiAdaptState(identity);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (events: readonly AgUiWireEvent[]) => {
        const encoded = encodeAgUiSse(events);
        if (!encoded) return;
        controller.enqueue(encoder.encode(encoded));
      };
      write(agUiRunStarted(state));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = drainRunSse(buffer, (event) => {
            write(adaptRunEventToAgUi(event, state));
          });
        }
        buffer += decoder.decode();
        buffer = drainRunSse(ensureFrameBoundary(buffer), (event) => {
          write(adaptRunEventToAgUi(event, state));
        });
        write(closeAgUiRun(state));
      } catch (error) {
        const message = error instanceof Error ? error.message : "执行失败";
        write(finishWithError(state, message));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export function agUiErrorResponse(
  identity: { threadId: string; runId: string },
  message: string,
): Response {
  const state = createAgUiAdaptState(identity);
  const body = encodeAgUiSse([...agUiRunStarted(state), ...finishWithError(state, message)]);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export function drainRunSse(
  buffer: string,
  onEvent: (event: RunEventEnvelope) => void,
): string {
  let rest = buffer;
  while (true) {
    const boundary = findBoundary(rest);
    if (!boundary) return rest;
    const raw = rest.slice(0, boundary.index);
    rest = rest.slice(boundary.index + boundary.length);
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim();
    if (!data) continue;
    const event = parseRunEvent(data);
    if (event) onEvent(event);
  }
}

function mutationCommittedEvent(payload: Record<string, unknown>): AgUiWireEvent {
  return {
    type: "CUSTOM",
    name: "mutation.committed",
    value: {
      mutationId: readString(payload.mutationId),
      revision: typeof payload.revision === "number" ? payload.revision : null,
      changeSetId: readString(payload.changeSetId) || null,
    },
  };
}

function waitingUser(state: AgUiAdaptState, eventId: string, question: string): AgUiWireEvent[] {
  const toolCallId = `ask-${eventId}`;
  const text = question || "需要你补充一个信息";
  const events: AgUiWireEvent[] = [
    ...closeText(state),
    { type: "TOOL_CALL_START", toolCallId, toolCallName: "resume_ask" },
    { type: "TOOL_CALL_END", toolCallId },
    {
      type: "TOOL_CALL_RESULT",
      messageId: `result-${toolCallId}`,
      toolCallId,
      content: JSON.stringify({
        toolCall: {
          id: toolCallId,
          name: "resume_ask",
          status: "completed",
          title: "需要你补充信息",
          summary: text,
          input: {},
          result: {},
        },
        question: text,
      }),
    },
  ];
  if (!state.ended) {
    state.ended = true;
    events.push({
      type: "RUN_FINISHED",
      threadId: state.threadId,
      runId: state.runId,
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: toolCallId,
            reason: "question",
            message: text,
            toolCallId,
          },
        ],
      },
    });
  }
  return events;
}

function finishTool(
  state: AgUiAdaptState,
  payload: Record<string, unknown>,
  status: "completed" | "error",
): AgUiWireEvent[] {
  const toolCallId = readString(payload.toolCallId);
  if (!toolCallId) return [];
  const toolName = readString(payload.toolName) || "tool";
  const summary =
    status === "error"
      ? readString(payload.message) || readString(payload.code) || "工具执行失败"
      : readString(payload.message) || `已执行 ${toolName}`;
  return [
    ...closeText(state),
    { type: "TOOL_CALL_END", toolCallId },
    {
      type: "TOOL_CALL_RESULT",
      messageId: `result-${toolCallId}`,
      toolCallId,
      content: JSON.stringify({
        toolCall: {
          id: toolCallId,
          name: toolName,
          status,
          title: toolName,
          summary,
          input: {},
          result: isRecord(payload.result) ? payload.result : {},
        },
      }),
    },
  ];
}

function finishOk(state: AgUiAdaptState): AgUiWireEvent[] {
  const events = closeText(state);
  if (state.ended) return events;
  state.ended = true;
  events.push({ type: "RUN_FINISHED", threadId: state.threadId, runId: state.runId });
  return events;
}

function finishWithError(state: AgUiAdaptState, message: string): AgUiWireEvent[] {
  const events = closeText(state);
  if (state.ended) return events;
  state.ended = true;
  events.push({ type: "RUN_ERROR", message });
  return events;
}

function openText(state: AgUiAdaptState, eventId: string): AgUiWireEvent[] {
  if (state.textMessageId) return [];
  state.textMessageId = `msg-${eventId}`;
  return [
    {
      type: "TEXT_MESSAGE_START",
      messageId: state.textMessageId,
      role: "assistant",
    },
  ];
}

function closeText(state: AgUiAdaptState): AgUiWireEvent[] {
  if (!state.textMessageId) return [];
  const messageId = state.textMessageId;
  state.textMessageId = null;
  return [{ type: "TEXT_MESSAGE_END", messageId }];
}

function readArgumentDelta(payload: Record<string, unknown>): string {
  const delta = readString(payload.delta);
  if (delta) return delta;
  if (payload.complete === true) return JSON.stringify(payload.input ?? {});
  return "";
}

function parseRunEvent(data: string): RunEventEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== 1) return null;
  if (typeof parsed.type !== "string" || !RUN_EVENT_TYPES.has(parsed.type as RunEventType)) {
    return null;
  }
  if (typeof parsed.eventId !== "string" || typeof parsed.runId !== "string") return null;
  return {
    schemaVersion: 1,
    eventId: parsed.eventId,
    runId: parsed.runId,
    attemptId: typeof parsed.attemptId === "string" ? parsed.attemptId : "",
    sequence: typeof parsed.sequence === "number" ? parsed.sequence : 0,
    type: parsed.type as RunEventType,
    occurredAt: typeof parsed.occurredAt === "string" ? parsed.occurredAt : "",
    payload: isRecord(parsed.payload) ? parsed.payload : {},
  };
}

function findBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf === -1 ? null : { index: crlf, length: 4 };
  if (crlf === -1) return { index: lf, length: 2 };
  return lf <= crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
}

function ensureFrameBoundary(buffer: string): string {
  if (!buffer.trim()) return buffer;
  if (buffer.endsWith("\n\n") || buffer.endsWith("\r\n\r\n")) return buffer;
  return `${buffer}\n\n`;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
