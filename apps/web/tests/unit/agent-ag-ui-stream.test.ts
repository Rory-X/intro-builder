import { EventType, type BaseEvent } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import {
  createAgUiSseStream,
  extractAgUiResumeToolResult,
  readAgUiSseStream,
} from "@/lib/agent/ag-ui-stream";

describe("AG-UI stream helpers", () => {
  it("encodes AG-UI events as text/event-stream", async () => {
    const event: BaseEvent = {
      type: EventType.RUN_STARTED,
      threadId: "thread_1",
      runId: "run_1",
    };

    const response = new Response(createAgUiSseStream([event]), {
      headers: { "content-type": "text/event-stream" },
    });

    await expect(response.text()).resolves.toBe(
      `data: ${JSON.stringify(event)}\n\n`,
    );
  });

  it("parses AG-UI SSE events split across arbitrary chunks", async () => {
    const events: BaseEvent[] = [
      { type: EventType.RUN_STARTED, threadId: "thread_1", runId: "run_1" },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "msg_1",
        role: "assistant",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "msg_1",
        delta: "先检查",
      },
      { type: EventType.TEXT_MESSAGE_END, messageId: "msg_1" },
      { type: EventType.RUN_FINISHED, threadId: "thread_1", runId: "run_1" },
    ];
    const response = new Response(createSplitSseStream(events), {
      headers: { "content-type": "text/event-stream" },
    });

    const parsed: BaseEvent[] = [];
    for await (const event of readAgUiSseStream(response)) {
      parsed.push(event);
    }

    expect(parsed).toEqual(events);
  });

  it("throws a useful error for malformed AG-UI event payloads", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {bad json}\n\n"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

    await expect(async () => {
      for await (const _event of readAgUiSseStream(response)) {
        void _event;
      }
    }).rejects.toThrow("Invalid AG-UI event JSON");
  });

  it("rejects SSE payloads that are not AG-UI events", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"hello":"world"}\n\n'));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

    await expect(async () => {
      for await (const _event of readAgUiSseStream(response)) {
        void _event;
      }
    }).rejects.toThrow("Invalid AG-UI event");
  });

  it("extracts resume tool result operations from AG-UI tool result events", () => {
    const event: BaseEvent = {
      type: EventType.TOOL_CALL_RESULT,
      messageId: "tool_1_result",
      toolCallId: "tool_1",
      role: "tool",
      content: JSON.stringify({
        toolCall: {
          id: "tool_1",
          name: "resume_update_section",
          status: "completed",
          title: "更新个人总结",
          summary: "生成一版更聚焦的个人总结。",
          input: {},
          result: {},
        },
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "应用个人总结改写",
            section: "summary",
            fieldPath: "basics.summary",
            operation: "update_section",
            beforePlainText: "三年前端经验。",
            afterPlainText: "三年前端工程经验，擅长 React 与工程化交付。",
            changeSummary: "让总结更具体。",
            riskFlags: [],
          },
        ],
      }),
    };

    expect(extractAgUiResumeToolResult(event)).toEqual({
      toolCall: expect.objectContaining({
        id: "tool_1",
        name: "resume_update_section",
      }),
      proposedOperations: [
        expect.objectContaining({
          id: "op_1",
          operation: "update_section",
        }),
      ],
    });
  });
});

function createSplitSseStream(events: BaseEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const encoded = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const chunks = [encoded.slice(0, 11), encoded.slice(11, 43), encoded.slice(43)];

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}
