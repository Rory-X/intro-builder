import { describe, expect, it } from "vitest";
import type { RunEventEnvelope, RunEventType } from "@intro-builder/shared/types";

import {
  adaptRunEventToAgUi,
  agUiRunStarted,
  closeAgUiRun,
  createAgUiAdaptState,
  drainRunSse,
  readMutationCommitted,
  translateRunSseResponse,
} from "@/lib/ai/ag-ui-from-run";

describe("Run 事件 → AG-UI", () => {
  it("文本增量会打开一条助手消息，并在结束时关闭", () => {
    const state = createAgUiAdaptState({ threadId: "thread-1", runId: "run-1" });
    const started = agUiRunStarted(state);
    const deltas = [
      ...adaptRunEventToAgUi(event("text.delta", { text: "你好" }, "e1"), state),
      ...adaptRunEventToAgUi(event("text.delta", { text: "，简历" }, "e2"), state),
    ];
    const closed = closeAgUiRun(state);

    expect(started).toEqual([{ type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" }]);
    expect(deltas.map((item) => item.type)).toEqual([
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_CONTENT",
    ]);
    expect(deltas[1]).toMatchObject({ delta: "你好" });
    expect(deltas[2]).toMatchObject({ delta: "，简历" });
    expect(deltas[1]?.messageId).toBe(deltas[2]?.messageId);
    expect(closed.map((item) => item.type)).toEqual(["TEXT_MESSAGE_END", "RUN_FINISHED"]);
  });

  it("工具成功不带 proposedOperations，避免 panel 再写一次库", () => {
    const state = createAgUiAdaptState({ threadId: "t", runId: "r" });
    const events = adaptRunEventToAgUi(
      event("tool.succeeded", {
        toolCallId: "call-1",
        toolName: "writeSkillsSection",
        result: { status: "committed" },
      }),
      state,
    );
    const result = events.find((item) => item.type === "TOOL_CALL_RESULT");
    expect(result?.toolCallId).toBe("call-1");
    const content = JSON.parse(String(result?.content)) as { proposedOperations?: unknown };
    expect(content.proposedOperations).toBeUndefined();
  });

  it("落盘回执是 CUSTOM，能被读成 revision", () => {
    const state = createAgUiAdaptState({ threadId: "t", runId: "r" });
    const [committed] = adaptRunEventToAgUi(
      event("mutation.committed", {
        mutationId: "mut-1",
        revision: 4,
        changeSetId: "cs-1",
      }),
      state,
    );
    expect(readMutationCommitted(committed!)).toEqual({
      mutationId: "mut-1",
      revision: 4,
      changeSetId: "cs-1",
    });
  });

  it("缺 revision 的回执不被当成可同步", () => {
    const state = createAgUiAdaptState({ threadId: "t", runId: "r" });
    const [committed] = adaptRunEventToAgUi(
      event("mutation.committed", { mutationId: "mut-1" }),
      state,
    );
    expect(readMutationCommitted(committed!)).toBeNull();
  });

  it("等待用户时发出问题中断，而不是普通完成", () => {
    const state = createAgUiAdaptState({ threadId: "t", runId: "r" });
    const events = adaptRunEventToAgUi(
      event("run.waiting_user", { question: "目标岗位是什么？" }, "ask-1"),
      state,
    );
    const finished = events.find((item) => item.type === "RUN_FINISHED");
    expect(finished?.outcome).toMatchObject({
      type: "interrupt",
      interrupts: [{ reason: "question", message: "目标岗位是什么？" }],
    });
    expect(closeAgUiRun(state)).toEqual([]);
  });

  it("失败事件变成 RUN_ERROR，不再补一次完成", () => {
    const state = createAgUiAdaptState({ threadId: "t", runId: "r" });
    const events = adaptRunEventToAgUi(event("run.failed", { message: "模型不可用" }), state);
    expect(events).toEqual([{ type: "RUN_ERROR", message: "模型不可用" }]);
    expect(closeAgUiRun(state)).toEqual([]);
  });

  it("把 Run SSE 翻译成 AG-UI，并认 CRLF 分帧", async () => {
    const payload = event("text.delta", { text: "已保存" }, "e9");
    const sse = `data: ${JSON.stringify(payload)}\r\n\r\n`;
    const response = translateRunSseResponse(
      new Response(sse, { headers: { "content-type": "text/event-stream" } }),
      { threadId: "thread-9", runId: "run-9" },
    );
    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain('"type":"RUN_STARTED"');
    expect(text).toContain('"delta":"已保存"');
    expect(text).toContain('"type":"RUN_FINISHED"');
    expect(text).not.toContain("streamUrl");
  });

  it("drain 会留下不完整的帧", () => {
    const seen: string[] = [];
    const rest = drainRunSse('data: {"schemaVersion":1}\n\ndata: {"partial"', (item) => {
      seen.push(item.type);
    });
    expect(seen).toEqual([]);
    expect(rest).toContain("partial");
  });
});

function event(
  type: RunEventType,
  payload: Record<string, unknown>,
  eventId = "event-1",
): RunEventEnvelope {
  return {
    schemaVersion: 1,
    eventId,
    runId: "db-run",
    attemptId: "attempt-1",
    sequence: 1,
    type,
    occurredAt: "2026-09-28T00:00:00.000Z",
    payload,
  };
}
