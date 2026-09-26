import { describe, expect, it } from "vitest";

import { AI_REQUEST_LIMITS } from "@/lib/ai/provider-policy";
import { buildHistoryFromEvents, buildSessionHistory, trimHistory } from "@/lib/ai/run-history";

/**
 * 对话历史重建（P07 切流的前置能力）。
 *
 * ## 为什么这个模块存在
 *
 * 浮窗是**多轮会话**，模型需要看到之前的问答才能理解「帮我再改改」这类指代。
 * 但新 Run 路由 `POST /api/ai/runs` 把 `history` **硬编码为空数组** ——
 * 在新路由还没有客户端消费方时不会暴露；一旦 P07 把浮窗切过来，
 * 每一轮都会变成「失忆」的第一轮。
 *
 * `continue` 路由内部已有这段逻辑，但它是**路由私有函数**：没有测试覆盖，
 * `start` 路由也无法复用。本模块把它抽出来共享。
 */

function delta(text: string) {
  return { type: "text.delta", payload: { text } };
}

function runEnd(type = "run.completed") {
  return { type, payload: {} };
}

describe("单轮事件重建", () => {
  it("把 text.delta 累积成一条助手消息", () => {
    const history = buildHistoryFromEvents([delta("你好"), delta("，"), delta("我来看看")]);
    expect(history).toEqual([{ role: "assistant", content: "你好，我来看看" }]);
  });

  it("结束事件把缓冲收成一条消息", () => {
    const history = buildHistoryFromEvents([
      delta("第一段"),
      runEnd("run.waiting_user"),
      delta("第二段"),
      runEnd("run.completed"),
    ]);
    expect(history).toEqual([
      { role: "assistant", content: "第一段" },
      { role: "assistant", content: "第二段" },
    ]);
  });

  it("**没有结束事件时已累积的文本仍然有效**（流可能中断）", () => {
    const history = buildHistoryFromEvents([delta("说到一半")]);
    expect(history).toEqual([{ role: "assistant", content: "说到一半" }]);
  });

  it("空文本不产生消息", () => {
    expect(buildHistoryFromEvents([delta("   ")])).toEqual([]);
    expect(buildHistoryFromEvents([delta(""), runEnd()])).toEqual([]);
  });

  it("**不重放工具调用**（那会让「继续」变成第二次修改）", () => {
    const history = buildHistoryFromEvents([
      { type: "tool.started", payload: { toolCallId: "c1", toolName: "updateProjectBlock" } },
      { type: "tool.succeeded", payload: { toolCallId: "c1" } },
      { type: "mutation.committed", payload: { mutationId: "m-1", revision: 2 } },
      delta("改好了"),
      runEnd(),
    ]);
    // 只有助手文本，没有任何工具痕迹。
    expect(history).toEqual([{ role: "assistant", content: "改好了" }]);
    expect(JSON.stringify(history)).not.toContain("updateProjectBlock");
    expect(JSON.stringify(history)).not.toContain("m-1");
  });

  it("非法 payload 不崩（text 不是字符串时忽略）", () => {
    const history = buildHistoryFromEvents([
      { type: "text.delta", payload: { text: 123 } },
      delta("正常"),
    ]);
    expect(history).toEqual([{ role: "assistant", content: "正常" }]);
  });

  it("空事件数组返回空历史", () => {
    expect(buildHistoryFromEvents([])).toEqual([]);
  });
});

describe("多轮会话重建", () => {
  it("**按轮次交替用户与助手消息**", () => {
    const history = buildSessionHistory([
      { userMessage: "帮我看看简历", events: [delta("好的，我看到了三个问题"), runEnd("run.waiting_user")] },
      { userMessage: "先改第一个", events: [delta("已修改项目描述"), runEnd()] },
    ]);
    expect(history).toEqual([
      { role: "user", content: "帮我看看简历" },
      { role: "assistant", content: "好的，我看到了三个问题" },
      { role: "user", content: "先改第一个" },
      { role: "assistant", content: "已修改项目描述" },
    ]);
  });

  it("**顺序是正序**（最早的在前；倒置的对话比没有更糟）", () => {
    const history = buildSessionHistory([
      { userMessage: "第一轮", events: [delta("回复一"), runEnd()] },
      { userMessage: "第二轮", events: [delta("回复二"), runEnd()] },
    ]);
    expect(history[0]).toEqual({ role: "user", content: "第一轮" });
    expect(history.at(-1)).toEqual({ role: "assistant", content: "回复二" });
  });

  it("某轮没有助手文本时仍然保留用户消息", () => {
    const history = buildSessionHistory([{ userMessage: "只提问", events: [] }]);
    expect(history).toEqual([{ role: "user", content: "只提问" }]);
  });

  it("空用户消息被跳过（不产生空的 user 条目）", () => {
    const history = buildSessionHistory([
      { userMessage: "   ", events: [delta("回复"), runEnd()] },
    ]);
    expect(history).toEqual([{ role: "assistant", content: "回复" }]);
  });

  it("空会话返回空历史", () => {
    expect(buildSessionHistory([])).toEqual([]);
  });
});

describe("裁剪（保留最近的）", () => {
  it("未超限时原样返回", () => {
    const history = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
    ];
    expect(trimHistory(history, 10)).toEqual(history);
  });

  it("**超限时保留最近的**（让用户能继续当前这轮）", () => {
    const history = Array.from({ length: 6 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${index}`,
    }));
    const trimmed = trimHistory(history, 4);
    expect(trimmed).toHaveLength(4);
    expect(trimmed.at(-1)?.content).toBe("m5");
    // 丢的是最旧的。
    expect(trimmed.map((item) => item.content)).not.toContain("m0");
  });

  it("**裁剪后不以助手消息开头**（模型期望对话从用户消息开始）", () => {
    const history = [
      { role: "user" as const, content: "u1" },
      { role: "assistant" as const, content: "a1" },
      { role: "user" as const, content: "u2" },
      { role: "assistant" as const, content: "a2" },
    ];
    // 裁到 3 条会得到 [a1, u2, a2] —— 开头是助手消息，需要再丢一条。
    const trimmed = trimHistory(history, 3);
    expect(trimmed[0].role).toBe("user");
    expect(trimmed).toEqual([
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ]);
  });

  it("**未超限但以助手消息开头也清理**（那种形状对模型同样非法）", () => {
    // buildSessionHistory 在某轮没有用户消息时会产出这种形状。
    const history = [
      { role: "assistant" as const, content: "无主的回复" },
      { role: "user" as const, content: "u1" },
      { role: "assistant" as const, content: "a1" },
    ];
    expect(trimHistory(history, 10)).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("maxMessages 为 0 时返回空（不返回全量）", () => {
    const history = [{ role: "user" as const, content: "a" }];
    expect(trimHistory(history, 0)).toEqual([]);
  });

  it("全助手消息被裁到空（无法以合法形状保留）", () => {
    const history = [{ role: "assistant" as const, content: "a" }];
    expect(trimHistory(history, 1)).toEqual([]);
  });

  it("**默认上限与服务端校验一致**（否则请求会被拒绝）", () => {
    const history = Array.from({ length: AI_REQUEST_LIMITS.maxHistoryMessages + 20 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${index}`,
    }));
    const trimmed = trimHistory(history, AI_REQUEST_LIMITS.maxHistoryMessages);
    // 不超上限 —— 超出会让服务端的 validateAiRequestInput 拒绝整个请求。
    expect(trimmed.length).toBeLessThanOrEqual(AI_REQUEST_LIMITS.maxHistoryMessages);
  });
});
