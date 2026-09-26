import { describe, expect, it } from "vitest";

import { adaptStreamPart } from "@/lib/ai/stream-adapter";

/**
 * 适配器必须吃得下**真实** AI SDK v6 `fullStream` 的片段形状。
 *
 * 背景：`ai-stream.test.ts` 里的片段是手写的，用的是 `toolCallId` /
 * `inputTextDelta`。但 SDK 的 `TextStreamPart`（`fullStream` 的元素类型）在
 * `tool-input-start` / `tool-input-delta` 上用的是 `id` / `delta` —— 只有
 * `tool-call` / `tool-result` 才叫 `toolCallId`。
 *
 * 也就是说：手写测试验证的是一套**并不存在的**输入。真实流送进来时，
 * `part.toolCallId` 是 `undefined`，适配器静默返回空数组，
 * 于是 **UI 永远不会收到 `tool.started`**，用户看不到工具在跑。
 *
 * 本文件按 SDK 的**真实字段名**构造片段（下面的类型直接取自 `TextStreamPart`），
 * 让它成为一条会失败的防线，而不是再写一次「自以为的形状」。
 */

/**
 * AI SDK v6 `TextStreamPart` 中与本模块相关的成员，字段名照抄 SDK 声明。
 * 这里刻意**不**加 `[key: string]: unknown`，好让字段名写错时无法通过类型检查。
 */
type RealSdkPart =
  | { type: "start" }
  | { type: "text-delta"; id: string; text: string }
  | { type: "tool-input-start"; id: string; toolName: string }
  | { type: "tool-input-delta"; id: string; delta: string }
  | { type: "tool-input-end"; id: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; output: unknown }
  | { type: "finish"; finishReason?: string };

function collect(parts: RealSdkPart[]) {
  const state = { startedTools: new Set<string>() };
  return parts.flatMap((part) => adaptStreamPart(part, state));
}

describe("stream-adapter 吃真实 SDK 片段形状", () => {
  it("tool-input-start 用 SDK 的 id 字段也要发出 tool.started", () => {
    const events = collect([{ type: "tool-input-start", id: "call-1", toolName: "readResume" }]);
    expect(events).toEqual([
      { type: "tool.started", payload: { toolCallId: "call-1", toolName: "readResume" } },
    ]);
  });

  it("同一个 id 重复出现只开始一次", () => {
    const events = collect([
      { type: "tool-input-start", id: "call-1", toolName: "readResume" },
      { type: "tool-input-start", id: "call-1", toolName: "readResume" },
    ]);
    expect(events.filter((e) => e.type === "tool.started")).toHaveLength(1);
  });

  it("tool-input-delta 用 SDK 的 delta 字段也要发出参数片段", () => {
    const events = collect([
      { type: "tool-input-start", id: "call-1", toolName: "updateBasicsBlock" },
      { type: "tool-input-delta", id: "call-1", delta: '{"name":' },
      { type: "tool-input-delta", id: "call-1", delta: '"林可"}' },
    ]);
    const deltas = events.filter((e) => e.type === "tool.arguments");
    expect(deltas).toHaveLength(2);
    expect(deltas.map((e) => e.payload.delta)).toEqual(['{"name":', '"林可"}']);
  });

  it("tool-call 仍然用 toolCallId（这一支 SDK 确实如此）", () => {
    const events = collect([
      { type: "tool-input-start", id: "call-1", toolName: "updateBasicsBlock" },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "updateBasicsBlock",
        input: { name: "林可" },
      },
    ]);
    const complete = events.find((e) => e.type === "tool.arguments" && e.payload.complete === true);
    expect(complete).toBeDefined();
    expect(complete?.payload.toolCallId).toBe("call-1");
  });

  it("真实事件序列能串成「开始 → 参数 → 结果」", () => {
    const events = collect([
      { type: "start" },
      { type: "text-delta", id: "t1", text: "我先看一下。" },
      { type: "tool-input-start", id: "call-1", toolName: "readResume" },
      { type: "tool-input-delta", id: "call-1", delta: "{}" },
      { type: "tool-call", toolCallId: "call-1", toolName: "readResume", input: {} },
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "readResume",
        output: { ok: true },
      },
      { type: "finish", finishReason: "stop" },
    ]);
    const types = events.map((e) => e.type);
    expect(types).toContain("tool.started");
    expect(types).toContain("tool.arguments");
    expect(types).toContain("tool.succeeded");
    // 工具的 started 必须早于它的 succeeded，否则 UI 无法把结果挂到工具卡上。
    expect(types.indexOf("tool.started")).toBeLessThan(types.indexOf("tool.succeeded"));
  });
});
