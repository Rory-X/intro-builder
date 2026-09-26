import { describe, expect, it } from "vitest";

import { buildHistoryFromMessages, buildRequestId } from "@/lib/ai-client/floating-history";
import { AI_REQUEST_LIMITS } from "@/lib/ai/provider-policy";

/**
 * 浮窗消息 → 对话历史（P07 任务 3 的最后一处纯逻辑）。
 *
 * `createFloatingRun` 接受 `history`，但调用方必须自己从浮窗的 `messages`
 * state 映射。这条映射有几个**不显然的判断**，每一个都对应一类真实的坏行为：
 *
 * | 判断 | 不做的后果 |
 * |---|---|
 * | 跳过流式生成中的消息 | 模型看到半句话，以为说过不完整的内容 |
 * | 跳过界面文案 | 模型看到一句自己从未说过的话 |
 * | 排除尾部当前消息 | 同一句话出现两次，模型以为用户重复说了 |
 * | 跳到服务端上限内 | 请求整体被拒，用户连当前这轮都发不出去 |
 * | 以用户消息开头 | 对部分模型是非法输入 |
 */

describe("基础映射", () => {
  it("用户与助手消息按顺序进入历史", () => {
    const history = buildHistoryFromMessages({
      messages: [
        { id: "m1", role: "user", content: "帮我看看简历" },
        { id: "m2", role: "assistant", content: "我看到三个问题" },
      ],
    });
    expect(history).toEqual([
      { role: "user", content: "帮我看看简历" },
      { role: "assistant", content: "我看到三个问题" },
    ]);
  });

  it("trim 前后空白", () => {
    const history = buildHistoryFromMessages({
      messages: [{ id: "m1", role: "user", content: "  有空格  " }],
    });
    expect(history[0].content).toBe("有空格");
  });
});

describe("**跳过流式生成中的消息**（否则模型看到半句话）", () => {
  it("streaming 的消息不进历史", () => {
    const history = buildHistoryFromMessages({
      messages: [
        { id: "m1", role: "user", content: "问题" },
        { id: "m2", role: "assistant", content: "说到一半", streaming: true },
      ],
    });
    expect(history).toEqual([{ role: "user", content: "问题" }]);
  });

  it("已完成的助手消息照常进入", () => {
    const history = buildHistoryFromMessages({
      messages: [
        { id: "m1", role: "user", content: "问题" },
        { id: "m2", role: "assistant", content: "完整回答", streaming: false },
      ],
    });
    expect(history).toHaveLength(2);
  });
});

describe("**跳过界面文案**（否则模型看到自己没说过的话）", () => {
  it("模型未配置提示不进历史", () => {
    const history = buildHistoryFromMessages({
      messages: [
        { id: "m1", role: "user", content: "帮我改" },
        { id: "m2", role: "assistant", content: "尚未配置模型，请先在设置里连接模型服务。" },
      ],
    });
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe("user");
  });

  it("可自定义界面文案集合（不硬编码在一处）", () => {
    const history = buildHistoryFromMessages({
      messages: [
        { id: "m1", role: "user", content: "问题" },
        { id: "m2", role: "assistant", content: "自定义占位" },
      ],
      uiOnlyMessages: ["自定义占位"],
    });
    expect(history).toHaveLength(1);
  });

  it("空内容不产生条目（例如只有工具卡的助手消息）", () => {
    const history = buildHistoryFromMessages({
      messages: [
        { id: "m1", role: "user", content: "问题" },
        { id: "m2", role: "assistant", content: "   " },
      ],
    });
    expect(history).toHaveLength(1);
  });
});

describe("**排除尾部当前消息**（否则同一句话出现两次）", () => {
  it("excludeTail=1 时最后一条不进历史", () => {
    const history = buildHistoryFromMessages({
      messages: [
        { id: "m1", role: "user", content: "第一轮" },
        { id: "m2", role: "assistant", content: "回复一" },
        { id: "m3", role: "user", content: "当前这轮" },
      ],
      excludeTail: 1,
    });
    expect(history).toEqual([
      { role: "user", content: "第一轮" },
      { role: "assistant", content: "回复一" },
    ]);
    // 当前这轮单独作为 message 传给服务端，不该同时出现在历史里。
    expect(history.some((item) => item.content === "当前这轮")).toBe(false);
  });

  it("excludeTail 超过长度时返回空（不抛异常）", () => {
    const history = buildHistoryFromMessages({
      messages: [{ id: "m1", role: "user", content: "唯一一条" }],
      excludeTail: 5,
    });
    expect(history).toEqual([]);
  });

  it("excludeTail 为负时按 0 处理（不误删头部）", () => {
    const history = buildHistoryFromMessages({
      messages: [{ id: "m1", role: "user", content: "唯一一条" }],
      excludeTail: -3,
    });
    expect(history).toHaveLength(1);
  });
});

describe("重复条目去重", () => {
  it("**与上一条同 role 且同文本时跳过**（流式追加可能产生重复）", () => {
    const history = buildHistoryFromMessages({
      messages: [
        { id: "m1", role: "user", content: "重复的话" },
        { id: "m2", role: "user", content: "重复的话" },
      ],
    });
    expect(history).toHaveLength(1);
  });

  it("不同 role 的同文本**不**去重（那是真实的一问一答）", () => {
    const history = buildHistoryFromMessages({
      messages: [
        { id: "m1", role: "user", content: "好" },
        { id: "m2", role: "assistant", content: "好" },
      ],
    });
    expect(history).toHaveLength(2);
  });

  it("不相邻的重复保留（中间有别的对话）", () => {
    const history = buildHistoryFromMessages({
      messages: [
        { id: "m1", role: "user", content: "A" },
        { id: "m2", role: "assistant", content: "B" },
        { id: "m3", role: "user", content: "A" },
      ],
    });
    expect(history).toHaveLength(3);
  });
});

describe("**裁剪到服务端上限**（否则请求整体被拒）", () => {
  it("超限时保留最近的，且不超上限", () => {
    const messages = Array.from({ length: 300 }, (_, index) => ({
      id: `m${index}`,
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `消息 ${index}`,
    }));
    const history = buildHistoryFromMessages({ messages });

    expect(history.length).toBeLessThanOrEqual(AI_REQUEST_LIMITS.maxHistoryMessages);
    // 保留的是最近的。
    expect(history.at(-1)?.content).toBe("消息 299");
  });

  it("**裁剪后以用户消息开头**（以助手开头对部分模型非法）", () => {
    const messages = Array.from({ length: 300 }, (_, index) => ({
      id: `m${index}`,
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `消息 ${index}`,
    }));
    const history = buildHistoryFromMessages({ messages });
    expect(history[0]?.role).toBe("user");
  });

  it("可自定义上限", () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      id: `m${index}`,
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `消息 ${index}`,
    }));
    expect(buildHistoryFromMessages({ messages, maxMessages: 4 }).length).toBeLessThanOrEqual(4);
  });

  it("上限为 0 时返回空", () => {
    const history = buildHistoryFromMessages({
      messages: [{ id: "m1", role: "user", content: "x" }],
      maxMessages: 0,
    });
    expect(history).toEqual([]);
  });
});

describe("边界情况", () => {
  it("空消息列表返回空历史", () => {
    expect(buildHistoryFromMessages({ messages: [] })).toEqual([]);
  });

  it("全部是界面文案时返回空（不产出以助手开头的历史）", () => {
    const history = buildHistoryFromMessages({
      messages: [{ id: "m1", role: "assistant", content: "AI 助手请求失败" }],
    });
    expect(history).toEqual([]);
  });

  it("纯函数：同输入同输出", () => {
    const messages = [
      { id: "m1", role: "user" as const, content: "A" },
      { id: "m2", role: "assistant" as const, content: "B" },
    ];
    expect(buildHistoryFromMessages({ messages })).toEqual(
      buildHistoryFromMessages({ messages }),
    );
  });

  it("不改动传入的数组", () => {
    const messages = [{ id: "m1", role: "user" as const, content: "A" }];
    const snapshot = JSON.stringify(messages);
    buildHistoryFromMessages({ messages });
    expect(JSON.stringify(messages)).toBe(snapshot);
  });
});

describe("幂等键生成（重试复用 vs 新提问新建）", () => {
  it("**同样的输入产生同样的键**（这是「重试复用」能成立的前提）", () => {
    const first = buildRequestId({ sessionId: "s-1", message: "帮我改", sequence: 1 });
    const second = buildRequestId({ sessionId: "s-1", message: "帮我改", sequence: 1 });
    expect(second).toBe(first);
  });

  it("**序号不同则键不同**（用户再次提问必须新建 Run）", () => {
    const first = buildRequestId({ sessionId: "s-1", message: "帮我改", sequence: 1 });
    const second = buildRequestId({ sessionId: "s-1", message: "帮我改", sequence: 2 });
    expect(second).not.toBe(first);
  });

  it("**消息内容不同则键不同**", () => {
    const first = buildRequestId({ sessionId: "s-1", message: "改 A", sequence: 1 });
    const second = buildRequestId({ sessionId: "s-1", message: "改 B", sequence: 1 });
    expect(second).not.toBe(first);
  });

  it("会话不同则键不同（跨会话不撞键）", () => {
    const first = buildRequestId({ sessionId: "s-1", message: "改", sequence: 1 });
    const second = buildRequestId({ sessionId: "s-2", message: "改", sequence: 1 });
    expect(second).not.toBe(first);
  });

  it("无会话时也能生成（用 anon 前缀）", () => {
    const id = buildRequestId({ sessionId: null, message: "改", sequence: 1 });
    expect(id.startsWith("anon-")).toBe(true);
  });

  it("**不依赖时间戳**（同毫秒连点也不会撞键 —— 靠序号区分）", () => {
    // 两次调用在同一毫秒内、内容相同，只有序号不同。
    const ids = new Set(
      [1, 2, 3, 4, 5].map((sequence) =>
        buildRequestId({ sessionId: "s-1", message: "连点", sequence }),
      ),
    );
    expect(ids.size).toBe(5);
  });

  it("键里带可读的会话前缀（便于日志归类）", () => {
    const id = buildRequestId({ sessionId: "abcdefgh-1234", message: "x", sequence: 1 });
    expect(id.startsWith("abcdefgh-1-")).toBe(true);
  });

  it("消息首尾空白不影响键（避免「同一句话多个键」）", () => {
    const first = buildRequestId({ sessionId: "s-1", message: "改一下", sequence: 1 });
    const second = buildRequestId({ sessionId: "s-1", message: "  改一下  ", sequence: 1 });
    expect(second).toBe(first);
  });
});
