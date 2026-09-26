import { describe, expect, it } from "vitest";
import type { RunEventEnvelope, RunEventType } from "@intro-builder/shared/types";

import {
  buildPersistableAssistantMessage,
  buildPersistableUserMessage,
  floatingSessionTitle,
} from "@/lib/ai/floating-persistence";

/**
 * 新路径的消息持久化（P07 任务 3 缺的一环）。
 *
 * ## 为什么需要它
 *
 * 旧路径会把自己的输出写进浮窗会话表（`agent_floating_chat_message`），
 * 刷新后按会话恢复的对话历史读的就是那张表。而统一 Run 路由**完全不写那张表** ——
 * 用户用新路径聊完、刷新页面，**对话历史里看不到那些消息**。
 *
 * 注意这不是「Run 无法恢复」：Run 自身状态可从
 * `GET /api/ai/runs/[runId]?events=1` 读到。缺的是**展示用**的会话历史。
 */

let counter = 0;
function event(type: RunEventType, payload: Record<string, unknown> = {}): RunEventEnvelope {
  counter += 1;
  return {
    schemaVersion: 1,
    eventId: `e-${counter}`,
    runId: "run-1",
    attemptId: "attempt-1",
    sequence: counter,
    type,
    occurredAt: new Date(0).toISOString(),
    payload,
  };
}

describe("助手消息投影", () => {
  it("累积文本增量", () => {
    const message = buildPersistableAssistantMessage([
      event("text.delta", { text: "我看到" }),
      event("text.delta", { text: "三个问题" }),
    ]);
    expect(message?.content).toBe("我看到三个问题");
    expect(message?.role).toBe("assistant");
  });

  it("**文本、工具、问题都空时不写消息**（避免空记录）", () => {
    expect(buildPersistableAssistantMessage([event("attempt.started")])).toBeNull();
    expect(buildPersistableAssistantMessage([])).toBeNull();
    expect(buildPersistableAssistantMessage([event("run.completed")])).toBeNull();
  });

  it("**工具已完成但没说话也写**（否则那一轮丢失）", () => {
    const message = buildPersistableAssistantMessage([
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
    ]);
    expect(message).not.toBeNull();
    expect(message?.toolCalls).toHaveLength(1);
    expect(message?.content).toBe("");
  });

  it("**只有 running 工具且无文本 → 不写**（存了会永久转圈）", () => {
    /*
     * 旧路径持久化时会过滤掉 running 的工具卡（`persistedToolCalls`）。
     * 若不写这条规则，刷新后那条工具卡会**永久转圈** ——
     * 没有任何后续事件会再更新它（那一轮已结束）。
     */
    const message = buildPersistableAssistantMessage([
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
    ]);
    expect(message).toBeNull();
  });
});

describe("工具卡状态", () => {
  it("succeeded → completed、failed → error（running 被过滤）", () => {
    const completed = buildPersistableAssistantMessage([
      event("text.delta", { text: "查完了" }),
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
    ]);
    expect(completed?.toolCalls[0]).toMatchObject({ id: "c1", status: "completed" });

    const failed = buildPersistableAssistantMessage([
      event("text.delta", { text: "查完了" }),
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.failed", { toolCallId: "c1", toolName: "readResume", code: "target_not_found" }),
    ]);
    expect(failed?.toolCalls[0]).toMatchObject({ id: "c1", status: "error" });
  });

  it("**`running` 的工具卡不入库**（与旧路径的 persistedToolCalls 一致）", () => {
    const message = buildPersistableAssistantMessage([
      event("text.delta", { text: "开始查" }),
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
    ]);
    // 有文本所以整条消息仍然写入，但那未完成的工具卡被过滤掉。
    expect(message?.toolCalls).toEqual([]);
  });

  it("**状态不倒退**（后到的 running 不覆盖已完成的）", () => {
    /*
     * 事件可能乱序到达（重放、并行工具）。让 running 覆盖 completed
     * 会让历史里的工具卡**永久转圈** —— 用户看到「还在执行」而它早就完成了。
     */
    const message = buildPersistableAssistantMessage([
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
    ]);
    expect(message?.toolCalls[0]).toMatchObject({ status: "completed" });
  });

  it("**同一工具的多次事件合成一条**（不重复计数）", () => {
    const message = buildPersistableAssistantMessage([
      event("text.delta", { text: "办理中" }),
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.started", { toolCallId: "c2", toolName: "updateProjectBlock" }),
      event("tool.succeeded", { toolCallId: "c2", toolName: "updateProjectBlock" }),
    ]);
    expect(message?.toolCalls).toHaveLength(2);
  });

  it("**缺 toolCallId 的工具事件被跳过**（无法挂到工具卡上）", () => {
    const message = buildPersistableAssistantMessage([
      event("text.delta", { text: "有内容" }),
      event("tool.started", { toolName: "readResume" }),
    ]);
    expect(message?.toolCalls).toEqual([]);
  });

  it("**不透传工具原始结果**（可能含简历完整快照）", () => {
    const message = buildPersistableAssistantMessage([
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", {
        toolCallId: "c1",
        toolName: "readResume",
        result: { resumeSnapshot: { secret: "全部简历内容" } },
      }),
    ]);
    const serialized = JSON.stringify(message);
    expect(serialized).not.toContain("resumeSnapshot");
    expect(serialized).not.toContain("全部简历内容");
  });
});

describe("等待问题", () => {
  it("带出问题与 id", () => {
    const message = buildPersistableAssistantMessage([
      event("run.waiting_user", {
        question: { questionId: "q1", question: "量化结果是什么？" },
      }),
    ]);
    expect(message?.parts.some((part) => part.type === "question")).toBe(true);
    expect(JSON.stringify(message)).toContain("量化结果是什么");
  });

  it("**缺 id 或缺文本的问题不入库**（无法追踪状态）", () => {
    const missingId = buildPersistableAssistantMessage([
      event("run.waiting_user", { question: { question: "只有文本" } }),
    ]);
    expect(missingId).toBeNull();

    const missingText = buildPersistableAssistantMessage([
      event("run.waiting_user", { question: { questionId: "q1" } }),
    ]);
    expect(missingText).toBeNull();
  });

  it("**只提问没文本也写**（否则追问内容丢失）", () => {
    const message = buildPersistableAssistantMessage([
      event("run.waiting_user", { question: { questionId: "q1", question: "请补充" } }),
    ]);
    expect(message).not.toBeNull();
  });
});

describe("parts 形状", () => {
  it("**文本在前、工具与问题在后**（与旧路径的渲染顺序一致）", () => {
    const message = buildPersistableAssistantMessage([
      event("text.delta", { text: "好的" }),
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
      event("run.waiting_user", { question: { questionId: "q1", question: "请补充" } }),
    ]);
    const types = message?.parts.map((part) => part.type);
    expect(types).toEqual(["text", "tool", "question"]);
  });

  it("**无文本时 parts 不含 text 条目**（不产生空文本块）", () => {
    const message = buildPersistableAssistantMessage([
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
    ]);
    expect(message?.parts.map((part) => part.type)).toEqual(["tool"]);
  });

  it("parts 的 id 稳定可推导（便于去重与渲染 key）", () => {
    const message = buildPersistableAssistantMessage([
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
    ]);
    expect(message?.parts[0].id).toBe("part_tool_c1");
  });
});

describe("用户消息投影", () => {
  it("保留内容", () => {
    const message = buildPersistableUserMessage("帮我看看简历");
    expect(message).toMatchObject({ role: "user", content: "帮我看看简历" });
  });

  it("trim 首尾空白", () => {
    expect(buildPersistableUserMessage("  有空格  ")?.content).toBe("有空格");
  });

  it("**空消息不产生记录**", () => {
    expect(buildPersistableUserMessage("   ")).toBeNull();
    expect(buildPersistableUserMessage("")).toBeNull();
  });
});

describe("会话标题", () => {
  it("取前 50 字符（与旧路径一致）", () => {
    const long = "一".repeat(80);
    expect(floatingSessionTitle(long)).toHaveLength(50);
  });

  it("短消息原样使用", () => {
    expect(floatingSessionTitle("  短标题  ")).toBe("短标题");
  });

  it("**两处标题规则同源**（单独成函数避免漂移）", () => {
    // 旧路径用 `lastUserMessage.content.trim().slice(0, 50)`。
    expect(floatingSessionTitle("abc")).toBe("abc".trim().slice(0, 50));
  });
});

describe("纯函数性质", () => {
  it("同输入同输出", () => {
    const events = [event("text.delta", { text: "x" })];
    expect(buildPersistableAssistantMessage(events)).toEqual(
      buildPersistableAssistantMessage(events),
    );
  });

  it("不改动传入数组", () => {
    const events = [event("text.delta", { text: "x" })];
    const snapshot = JSON.stringify(events);
    buildPersistableAssistantMessage(events);
    expect(JSON.stringify(events)).toBe(snapshot);
  });
});
