import { BaseEventSchema, type BaseEvent } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";

import type {
  AgentToolCall,
  ResumeOperation,
} from "@intro-builder/shared/types";

export type AgUiResumeToolResult = {
  toolCall: AgentToolCall;
  proposedOperations: ResumeOperation[];
};

export function createAgUiSseStream(
  events: Iterable<BaseEvent>,
  accept?: string,
): ReadableStream<Uint8Array> {
  const encoder = new EventEncoder({ accept });
  const textEncoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(textEncoder.encode(encoder.encode(event)));
      }
      controller.close();
    },
  });
}

export async function* readAgUiSseStream(
  response: Response,
): AsyncGenerator<BaseEvent> {
  if (!response.body) {
    throw new Error("AG-UI stream response body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      yield* drainSseEvents(buffer, (nextBuffer) => {
        buffer = nextBuffer;
      });
    }

    buffer += decoder.decode();
    yield* drainSseEvents(`${buffer}\n\n`, (nextBuffer) => {
      buffer = nextBuffer;
    });
  } finally {
    reader.releaseLock();
  }
}

function* drainSseEvents(
  buffer: string,
  setBuffer: (buffer: string) => void,
): Generator<BaseEvent> {
  let nextBuffer = buffer;
  let boundary = nextBuffer.indexOf("\n\n");

  while (boundary !== -1) {
    const rawEvent = nextBuffer.slice(0, boundary);
    nextBuffer = nextBuffer.slice(boundary + 2);
    boundary = nextBuffer.indexOf("\n\n");

    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");

    if (!data.trim()) continue;
    yield parseAgUiEvent(data);
  }

  setBuffer(nextBuffer);
}

function parseAgUiEvent(data: string): BaseEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new Error("Invalid AG-UI event JSON", { cause: error });
  }

  const result = BaseEventSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Invalid AG-UI event", { cause: result.error });
  }
  return result.data;
}

export function extractAgUiResumeToolResult(
  event: BaseEvent,
): AgUiResumeToolResult | null {
  if (event.type !== "TOOL_CALL_RESULT") return null;
  if (typeof event.content !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!isAgentToolCall(parsed.toolCall)) return null;
  if (!Array.isArray(parsed.proposedOperations)) return null;

  return {
    toolCall: parsed.toolCall,
    proposedOperations: parsed.proposedOperations.filter(isResumeOperation),
  };
}

function isAgentToolCall(value: unknown): value is AgentToolCall {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isAgentToolName(value.name) &&
    value.status === "completed" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    isRecord(value.input) &&
    isRecord(value.result)
  );
}

function isResumeOperation(value: unknown): value is ResumeOperation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.toolCallId === "string" &&
    typeof value.label === "string" &&
    typeof value.section === "string" &&
    typeof value.fieldPath === "string" &&
    isResumeOperationName(value.operation) &&
    typeof value.beforePlainText === "string" &&
    typeof value.afterPlainText === "string" &&
    typeof value.changeSummary === "string" &&
    Array.isArray(value.riskFlags)
  );
}

function isAgentToolName(value: unknown): value is AgentToolCall["name"] {
  return (
    value === "resume_read" ||
    value === "resume_update_section" ||
    value === "resume_delete_section" ||
    value === "resume_reorder_sections" ||
    value === "resume_insert_section"
  );
}

function isResumeOperationName(value: unknown): value is ResumeOperation["operation"] {
  return (
    value === "update_section" ||
    value === "delete_section" ||
    value === "reorder_sections" ||
    value === "insert_section"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
