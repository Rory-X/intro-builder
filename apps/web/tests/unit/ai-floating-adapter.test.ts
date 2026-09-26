import { describe, expect, it } from "vitest";
import type { RunEventEnvelope, RunEventType } from "@intro-builder/shared/types";

import {
  adaptRunEventToAction,
  adaptRunEvents,
  endStatusFromRunStatus,
  isEndStatus,
  isSuccessfulEnd,
} from "@/lib/ai-client/floating-adapter";

/**
 * 新旧协议适配（P07 任务 3）。
 *
 * 浮窗消费的是**旧微服务**的 SSE 协议（`text-delta` / `tool-call-start` /
 * `approval-request` / `question-request` / `done`），而新 Run 路由走统一事件流
 * （P04 契约）。两套协议的**语义单位不同**，不是改字段名能对上的。
 *
 * 本模块是纯函数：事件 → 浮窗动作。切流时组件只需把「解析旧协议」
 * 换成「调这里」，状态更新逻辑不用动。
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

function reset() {
  counter = 0;
}

describe("文本增量", () => {
  it("text.delta → text 动作", () => {
    expect(adaptRunEventToAction(event("text.delta", { text: "你好" }))).toEqual({
      kind: "text",
      delta: "你好",
    });
  });

  it("**空 delta 不产生动作**（否则会产生无意义的渲染批次）", () => {
    expect(adaptRunEventToAction(event("text.delta", { text: "" }))).toBeNull();
    expect(adaptRunEventToAction(event("text.delta", {}))).toBeNull();
  });
});

describe("工具生命周期（旧协议三阶段 → 新协议分事件）", () => {
  it("tool.started → running 状态", () => {
    const action = adaptRunEventToAction(
      event("tool.started", { toolCallId: "c1", toolName: "updateProjectBlock" }),
    );
    expect(action).toEqual({
      kind: "tool",
      toolCall: {
        id: "c1",
        name: "updateProjectBlock",
        status: "running",
        summary: "更新项目经历",
      },
    });
  });

  it("tool.succeeded → completed", () => {
    const action = adaptRunEventToAction(
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume", result: { ok: true } }),
    );
    expect(action).toEqual({
      kind: "tool",
      toolCall: {
        id: "c1",
        name: "readResume",
        status: "completed",
        summary: "读取简历内容",
      },
    });
  });

  it("**刻意不透传原始 result**（浮窗会 JSON.stringify 渲染 output）", () => {
    /*
     * 浮窗的 formatToolPayload 会把 output 直接序列化展示。
     * 工具结果里可能含简历完整快照或内部字段 —— 那不该出现在聊天流里。
     */
    const action = adaptRunEventToAction(
      event("tool.succeeded", {
        toolCallId: "c1",
        toolName: "readResume",
        result: { resumeSnapshot: { secret: "全部内容" } },
      }),
    );
    expect(action).not.toHaveProperty("toolCall.output");
    expect(JSON.stringify(action)).not.toContain("resumeSnapshot");
    expect(JSON.stringify(action)).not.toContain("全部内容");
  });

  it("tool.failed → error，且 errorText 是可操作中文（不是原始码）", () => {
    const action = adaptRunEventToAction(
      event("tool.failed", { toolCallId: "c1", toolName: "updateProjectBlock", code: "target_not_found" }),
    );
    expect(action).toMatchObject({
      kind: "tool",
      toolCall: { status: "error", errorText: "找不到这条内容，可能已被删除" },
    });
    expect(JSON.stringify(action)).not.toContain("target_not_found");
  });

  it("未识别的失败码有兜底文案", () => {
    const action = adaptRunEventToAction(
      event("tool.failed", { toolCallId: "c1", toolName: "readResume", code: "weird" }),
    );
    expect(action).toMatchObject({ toolCall: { errorText: "这一步没有完成" } });
    expect(JSON.stringify(action)).not.toContain("weird");
  });

  it("**未知工具不回显内部名**（对用户没有意义）", () => {
    const action = adaptRunEventToAction(
      event("tool.started", { toolCallId: "c1", toolName: "someInternalTool" }),
    );
    expect(action).toMatchObject({ toolCall: { summary: "执行一项操作" } });
    expect(JSON.stringify(action)).not.toContain("someInternalTool");
  });

  it("工具名前缀能匹配到具体动作（体验优于兜底文案）", () => {
    const action = adaptRunEventToAction(
      event("tool.started", { toolCallId: "c1", toolName: "updateWorkExperienceBlock" }),
    );
    expect(action).toMatchObject({ toolCall: { summary: "更新工作经历" } });
  });

  it("**缺 toolCallId 时不产生动作**（无法挂到工具卡上）", () => {
    expect(adaptRunEventToAction(event("tool.started", { toolName: "readResume" }))).toBeNull();
    expect(adaptRunEventToAction(event("tool.succeeded", {}))).toBeNull();
  });

  it("tool.arguments 把参数增量作为 input 透出", () => {
    const action = adaptRunEventToAction(
      event("tool.arguments", { toolCallId: "c1", toolName: "readResume", delta: '{"section"' }),
    );
    expect(action).toMatchObject({ kind: "tool", toolCall: { input: '{"section"' } });
  });

  it("tool.arguments 空增量不产生动作", () => {
    expect(
      adaptRunEventToAction(event("tool.arguments", { toolCallId: "c1", delta: "" })),
    ).toBeNull();
  });
});

describe("提案与回执（批准 ≠ 已保存）", () => {
  it("proposal.ready → proposal 动作（调用方去拉 changeSet）", () => {
    const action = adaptRunEventToAction(
      event("proposal.ready", { changeSetId: "cs-1", proposalVersion: 2, summary: "优化描述" }),
    );
    expect(action).toEqual({
      kind: "proposal",
      changeSetId: "cs-1",
      proposalVersion: 2,
      summary: "优化描述",
    });
  });

  it("缺 changeSetId 时降级为「生成修改建议」之外的兜底（不产生无效目标）", () => {
    // 没有 id 就无法拉取提案 —— 不产生动作比给一个空 id 好。
    expect(adaptRunEventToAction(event("proposal.ready", { summary: "x" }))).toBeNull();
  });

  it("**mutation.committed 是唯一能驱动「已保存」的动作**", () => {
    const action = adaptRunEventToAction(
      event("mutation.committed", { mutationId: "m-1", revision: 5 }),
    );
    expect(action).toEqual({ kind: "committed", mutationId: "m-1", revision: 5 });
  });

  it("回执缺 revision 时为 null（不编一个版本号）", () => {
    const action = adaptRunEventToAction(event("mutation.committed", { mutationId: "m-1" }));
    expect(action).toMatchObject({ kind: "committed", revision: null });
  });

  it("mutation.conflict → conflict 动作（需要用户处理）", () => {
    const action = adaptRunEventToAction(
      event("mutation.conflict", { mutationId: "m-1", message: "已被别处修改" }),
    );
    expect(action).toEqual({ kind: "conflict", mutationId: "m-1", message: "已被别处修改" });
  });

  it("冲突缺 message 时有默认说明", () => {
    const action = adaptRunEventToAction(event("mutation.conflict", { mutationId: "m-1" }));
    expect(action).toMatchObject({ message: "这处内容已被别处修改，需要你先确认" });
  });

  it("**proposal.ready 不产生 committed**（批准不等于落盘）", () => {
    const action = adaptRunEventToAction(
      event("proposal.ready", { changeSetId: "cs-1", summary: "x" }),
    );
    expect(action?.kind).toBe("proposal");
    expect(action?.kind).not.toBe("committed");
  });
});

describe("等待用户（旧 question-request → 新 run.waiting_user）", () => {
  it("带出问题与 id", () => {
    const action = adaptRunEventToAction(
      event("run.waiting_user", {
        question: { questionId: "q-1", question: "这个项目的量化结果是什么？" },
      }),
    );
    expect(action).toEqual({
      kind: "question",
      question: { id: "q-1", question: "这个项目的量化结果是什么？", status: "pending" },
    });
  });

  it("带 target 时映射为 field", () => {
    const action = adaptRunEventToAction(
      event("run.waiting_user", {
        question: { questionId: "q-1", question: "x", target: "experience.content" },
      }),
    );
    expect(action).toMatchObject({ question: { field: "experience.content" } });
  });

  it("**缺 questionId 时不编一个 id**（编的 id 会让「已答」标记找不到目标）", () => {
    const action = adaptRunEventToAction(
      event("run.waiting_user", { question: { question: "只有文本" } }),
    );
    // 降级为「结束」而不是产生一个无法追踪的问题。
    expect(action).toEqual({ kind: "ended", status: "waiting_user", reason: null });
  });

  it("完全没有 question 时同样降级为结束", () => {
    expect(adaptRunEventToAction(event("run.waiting_user", {}))).toEqual({
      kind: "ended",
      status: "waiting_user",
      reason: null,
    });
  });
});

describe("终态（旧 done → 新四种）", () => {
  it("四种终态各自映射", () => {
    expect(adaptRunEventToAction(event("run.completed"))).toEqual({
      kind: "ended",
      status: "completed",
      reason: null,
    });
    expect(adaptRunEventToAction(event("run.failed", { message: "模型挂了" }))).toEqual({
      kind: "ended",
      status: "failed",
      reason: "模型挂了",
    });
    expect(adaptRunEventToAction(event("run.cancelled"))).toEqual({
      kind: "ended",
      status: "cancelled",
      reason: null,
    });
    expect(adaptRunEventToAction(event("run.interrupted", { reason: "连接中断" }))).toEqual({
      kind: "ended",
      status: "interrupted",
      reason: "连接中断",
    });
  });

  it("**waiting_user 也算结束**（否则界面永远转圈）", () => {
    expect(isEndStatus("waiting_user")).toBe(false);
    // 但它在浮窗语义上确实终结了本轮 —— 由 isSuccessfulEnd 表达。
    expect(isSuccessfulEnd("waiting_user")).toBe(true);
  });

  it("isEndStatus 只对真终态为 true", () => {
    expect(isEndStatus("completed")).toBe(true);
    expect(isEndStatus("failed")).toBe(true);
    expect(isEndStatus("cancelled")).toBe(true);
    expect(isEndStatus("interrupted")).toBe(true);
    expect(isEndStatus("waiting_user")).toBe(false);
  });

  it("isSuccessfulEnd 区分正常与异常结束", () => {
    expect(isSuccessfulEnd("completed")).toBe(true);
    expect(isSuccessfulEnd("waiting_user")).toBe(true);
    expect(isSuccessfulEnd("failed")).toBe(false);
    expect(isSuccessfulEnd("cancelled")).toBe(false);
    expect(isSuccessfulEnd("interrupted")).toBe(false);
  });

  it("endStatusFromRunStatus 映射服务端状态（running 视为中断）", () => {
    expect(endStatusFromRunStatus("completed")).toBe("completed");
    expect(endStatusFromRunStatus("failed")).toBe("failed");
    expect(endStatusFromRunStatus("cancelled")).toBe("cancelled");
    expect(endStatusFromRunStatus("waiting_user")).toBe("waiting_user");
    expect(endStatusFromRunStatus("interrupted")).toBe("interrupted");
    // 服务端说 running 但流已结束 → 是连接问题，不是「还在跑」。
    expect(endStatusFromRunStatus("running")).toBe("interrupted");
  });
});

describe("不需要动作的事件", () => {
  it("attempt.started 不产生动作（没有可展示内容）", () => {
    expect(adaptRunEventToAction(event("attempt.started"))).toBeNull();
  });

  it("decision.recorded 不产生动作（由提案卡驱动，不走消息流）", () => {
    expect(
      adaptRunEventToAction(event("decision.recorded", { changeSetId: "cs-1", proposalVersion: 1 })),
    ).toBeNull();
  });

  it("run.started / text 之外的类型都不崩", () => {
    for (const type of ["run.started", "attempt.started"] as const) {
      expect(() => adaptRunEventToAction(event(type))).not.toThrow();
    }
  });
});

describe("批量适配（刷新恢复场景）", () => {
  it("过滤掉无动作事件，保留顺序", () => {
    reset();
    const actions = adaptRunEvents([
      event("attempt.started"),
      event("text.delta", { text: "第一段" }),
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
      event("decision.recorded", { changeSetId: "cs-1", proposalVersion: 1 }),
      event("run.completed"),
    ]);
    expect(actions.map((action) => action.kind)).toEqual(["text", "tool", "tool", "ended"]);
  });

  it("空数组返回空", () => {
    expect(adaptRunEvents([])).toEqual([]);
  });

  it("纯函数：同输入同输出", () => {
    reset();
    const events = [event("text.delta", { text: "x" }), event("run.completed")];
    expect(adaptRunEvents(events)).toEqual(adaptRunEvents(events));
  });
});

describe("不泄漏内部信息", () => {
  it("适配结果不含工具原始参数、密钥或事件 id", () => {
    reset();
    const actions = adaptRunEvents([
      event("tool.started", {
        toolCallId: "c1",
        toolName: "updateBasicsBlock",
        args: { apiKey: "sk-secret" },
      }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "updateBasicsBlock", result: { raw: "sk-secret" } }),
    ]);
    const serialized = JSON.stringify(actions);
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("e-");
  });
});
