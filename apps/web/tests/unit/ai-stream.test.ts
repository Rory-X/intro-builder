import { describe, expect, it } from "vitest";

import {
  adaptStreamPart,
  finalizeAttempt,
  finalizeOnInterrupt,
  isAttemptEndDraft,
  type SdkStreamPart,
} from "@/lib/ai/stream-adapter";

function adapterState() {
  return { startedTools: new Set<string>() };
}

/** 便捷：把一串片段喂给适配器，收集全部业务事件。 */
function collect(parts: SdkStreamPart[]) {
  const state = adapterState();
  return parts.flatMap((part) => adaptStreamPart(part, state));
}

describe("流适配器：文本", () => {
  it("文本增量转成 text.delta", () => {
    const events = collect([
      { type: "text-start" },
      { type: "text-delta", text: "你" },
      { type: "text-delta", text: "好" },
      { type: "text-end" },
    ]);
    expect(events).toEqual([
      { type: "text.delta", payload: { text: "你", id: undefined } },
      { type: "text.delta", payload: { text: "好", id: undefined } },
    ]);
  });

  it("空增量不产生事件（不制造无意义的 UI 更新）", () => {
    expect(collect([{ type: "text-delta", text: "" }])).toEqual([]);
    expect(collect([{ type: "text-delta" }])).toEqual([]);
  });

  it("推理内容不进入业务事件流（不持久化、不展示）", () => {
    expect(collect([{ type: "reasoning-delta", text: "让我想想…" }])).toEqual([]);
  });

  it("start 与文本边界不产生事件", () => {
    expect(collect([{ type: "start" }, { type: "text-start" }, { type: "text-end" }])).toEqual([]);
  });
});

describe("流适配器：工具调用", () => {
  it("工具开始转成 tool.started", () => {
    const events = collect([{ type: "tool-input-start", toolCallId: "c1", toolName: "readResume" }]);
    expect(events).toEqual([
      { type: "tool.started", payload: { toolCallId: "c1", toolName: "readResume" } },
    ]);
  });

  it("同一 toolCallId 只开始一次（不产生重复卡片）", () => {
    const events = collect([
      { type: "tool-input-start", toolCallId: "c1", toolName: "readResume" },
      { type: "tool-input-start", toolCallId: "c1", toolName: "readResume" },
    ]);
    expect(events.filter((e) => e.type === "tool.started")).toHaveLength(1);
  });

  it("参数片段累积为 tool.arguments，且不带 complete 标记", () => {
    const events = collect([
      { type: "tool-input-start", toolCallId: "c1", toolName: "x" },
      { type: "tool-input-delta", toolCallId: "c1", inputTextDelta: '{"sec' },
      { type: "tool-input-delta", toolCallId: "c1", inputTextDelta: 'tion":"basics"}' },
    ]);
    const argEvents = events.filter((e) => e.type === "tool.arguments");
    expect(argEvents).toHaveLength(2);
    // 参数片段不得被标记为完整 —— 它可能永远不完整。
    expect(argEvents[0].payload.complete).toBeUndefined();
  });

  it("完整参数到达时标记 complete（但仍不由适配器执行）", () => {
    const events = collect([
      { type: "tool-input-start", toolCallId: "c1", toolName: "x" },
      { type: "tool-call", toolCallId: "c1", toolName: "x", input: { section: "basics" } },
    ]);
    const complete = events.find((e) => e.type === "tool.arguments" && e.payload.complete === true);
    expect(complete).toBeDefined();
    expect(complete?.payload.input).toEqual({ section: "basics" });
  });

  it("工具结果转成 tool.succeeded，并透出提交关联", () => {
    const events = collect([
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "addWorkExperience",
        output: { status: "committed", mutationId: "m-1", changeSetId: "cs-1" },
      },
    ]);
    expect(events[0].type).toBe("tool.succeeded");
    expect(events[0].payload.mutationId).toBe("m-1");
    expect(events[0].payload.changeSetId).toBe("cs-1");
  });

  it("工具错误转成 tool.failed 并带错误码（不当成成功）", () => {
    const events = collect([
      { type: "tool-error", toolCallId: "c1", toolName: "x", error: { code: "provider_timeout" } },
    ]);
    expect(events[0].type).toBe("tool.failed");
    expect(events[0].payload.code).toBe("provider_timeout");
  });

  it("缺少 toolCallId 的片段被忽略（无法归属的事件不发出）", () => {
    expect(collect([{ type: "tool-input-delta", toolCallId: "", inputTextDelta: "x" }])).toEqual([]);
    expect(collect([{ type: "tool-result", toolCallId: "" }])).toEqual([]);
  });
});

describe("流适配器：finish 不等于完成", () => {
  it("finish 片段本身不产生结束事件", () => {
    const events = collect([
      { type: "text-delta", text: "帮你改好了" },
      { type: "finish", finishReason: "stop" },
    ]);
    expect(events.some((e) => isAttemptEndDraft(e))).toBe(false);
  });

  it("出错片段产生 run.failed", () => {
    const events = collect([{ type: "error", error: { code: "rate_limited", message: "限流" } }]);
    expect(events[0].type).toBe("run.failed");
    expect(events[0].payload.code).toBe("rate_limited");
  });

  it("未知片段类型被忽略，不猜测语义", () => {
    expect(collect([{ type: "some-future-part", whatever: 1 }])).toEqual([]);
  });
});

describe("attempt 结束：判据顺序与不假称完成", () => {
  it("正常走完 → run.completed", () => {
    expect(finalizeAttempt()).toEqual({ type: "run.completed", payload: {} });
  });

  it("等待用户 → run.waiting_user", () => {
    expect(finalizeAttempt({ shouldWaitForUser: () => true }).type).toBe("run.waiting_user");
  });

  it("取消优先于完成（点了取消就不能显示完成）", () => {
    const result = finalizeAttempt({
      isCancelled: () => true,
      shouldWaitForUser: () => true,
    });
    expect(result.type).toBe("run.cancelled");
  });

  it("有错误时失败优先于等待用户", () => {
    const result = finalizeAttempt({
      sawError: { code: "provider_timeout", message: "模型超时" },
      shouldWaitForUser: () => true,
    });
    expect(result.type).toBe("run.failed");
  });
});

describe("连接中断：一律 interrupted", () => {
  it("无取消无错误 → interrupted（不是 completed）", () => {
    const result = finalizeOnInterrupt();
    expect(result.type).toBe("run.interrupted");
    expect(result.payload.reason).toContain("中断");
  });

  it("已取消时中断判定为 cancelled", () => {
    expect(finalizeOnInterrupt({ isCancelled: () => true }).type).toBe("run.cancelled");
  });

  it("已有错误时中断判定为 failed", () => {
    expect(
      finalizeOnInterrupt({ sawError: { code: "x", message: "y" } }).type,
    ).toBe("run.failed");
  });

  it("中断时不会声称等待用户（连接断了没人能回答）", () => {
    const result = finalizeOnInterrupt({ shouldWaitForUser: () => true });
    expect(result.type).toBe("run.interrupted");
  });
});

describe("结束事件识别（一个 attempt 只能有一个）", () => {
  it("五个结束类型都被识别", () => {
    for (const type of [
      "run.waiting_user",
      "run.interrupted",
      "run.completed",
      "run.failed",
      "run.cancelled",
    ] as const) {
      expect(isAttemptEndDraft({ type, payload: {} }), type).toBe(true);
    }
  });

  it("非结束类型不被误判", () => {
    for (const type of ["text.delta", "tool.started", "tool.succeeded", "mutation.committed"] as const) {
      expect(isAttemptEndDraft({ type, payload: {} }), type).toBe(false);
    }
  });
});
