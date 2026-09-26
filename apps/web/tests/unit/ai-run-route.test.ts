import { describe, expect, it } from "vitest";
import { emptyResumeContent, ResumeContent } from "@intro-builder/shared/schemas";
import type { RunEventType } from "@intro-builder/shared/types";

import { orchestrateRun, toolTouchedDocument, type RunDeps, type ToolExecutionResult } from "@/lib/ai/run";
import type { BusinessEventDraft, SdkStreamPart } from "@/lib/ai/stream-adapter";

/**
 * 编排层的完整业务流测试（P04 任务 2/4）。
 *
 * 全部依赖注入，因此可覆盖失败、取消、截断等真实难以构造的场景，
 * 而不需要真实模型或数据库。业务预期固定，SDK/存储适配器可替换。
 */

function doc(text: string) {
  return { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function content(): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    experience: [
      { id: "exp-a", company: "甲公司", title: "前端", start: "", end: "", location: "", content: doc("做甲") },
    ],
    sectionOrder: ["basics", "experience"],
  });
}

type Harness = {
  deps: RunDeps;
  events: BusinessEventDraft[];
  endType: RunEventType | null;
  run: (overrides?: Partial<Parameters<typeof orchestrateRun>[1]>) => ReturnType<typeof orchestrateRun>;
};

function harness(options: {
  parts: SdkStreamPart[] | (() => AsyncIterable<SdkStreamPart>);
  toolOutcome?: ToolExecutionResult | ((name: string) => ToolExecutionResult);
  writable?: boolean;
  cancelled?: boolean;
  waitForUser?: boolean;
  throwAt?: number;
}): Harness {
  const events: BusinessEventDraft[] = [];
  let endType: RunEventType | null = null;

  const deps: RunDeps = {
    loadWorkspaceSource: async () => ({
      content: content(),
      revision: 5,
      title: "我的简历",
      templateId: "classic",
    }),
    streamModel: () => {
      const parts = options.parts;
      if (typeof parts === "function") return parts();
      return (async function* () {
        let index = 0;
        for (const part of parts) {
          index += 1;
          if (options.throwAt !== undefined && index === options.throwAt) {
            throw new Error("连接被中断");
          }
          yield part;
        }
      })();
    },
    executeTool: async ({ toolName }) => {
      const base = options.toolOutcome ?? { status: "succeeded", result: {} };
      return typeof base === "function" ? base(toolName) : base;
    },
    emitEvent: async (draft) => {
      events.push(draft);
    },
    isWritable: async () => options.writable ?? true,
    isCancelled: () => options.cancelled ?? false,
    shouldWaitForUser: () => options.waitForUser ?? false,
    buildSystemPrompt: () => "system",
    buildMessages: () => [],
    buildTools: () => ({}),
  };

  return {
    deps,
    events,
    get endType() {
      return endType;
    },
    run: async (overrides = {}) => {
      const result = await orchestrateRun(deps, {
        runId: "run-1",
        resumeId: "resume-1",
        userId: "user-1",
        attemptId: "att-1",
        writeMode: "direct",
        abortSignal: new AbortController().signal,
        ...overrides,
      });
      endType = result.endType;
      return result;
    },
  } as Harness;
}

describe("编排：正常流程", () => {
  it("文本流与结束事件（attempt.started → text → completed）", async () => {
    const h = harness({
      parts: [
        { type: "text-delta", text: "你好" },
        { type: "finish", finishReason: "stop" },
      ],
    });
    const result = await h.run();

    expect(result.endType).toBe("run.completed");
    expect(h.events.map((e) => e.type)).toEqual([
      "attempt.started",
      "text.delta",
      "run.completed",
    ]);
  });

  it("emitted 计数与实际事件数一致", async () => {
    const h = harness({ parts: [{ type: "text-delta", text: "x" }, { type: "finish" }] });
    const result = await h.run();
    expect(result.emitted).toBe(h.events.length);
  });
});

describe("编排：工具与提交", () => {
  it("工具返回真实回执时才计入 committed 并发出 mutation.committed", async () => {
    const h = harness({
      parts: [
        { type: "tool-input-start", toolCallId: "c1", toolName: "updateBasicsBlock" },
        { type: "tool-call", toolCallId: "c1", toolName: "updateBasicsBlock", input: { name: "李四" } },
        { type: "finish" },
      ],
      toolOutcome: {
        status: "succeeded",
        result: { applied: true },
        mutationId: "mut-1",
        revision: 6,
        changeSetId: "cs-1",
      },
    });
    const result = await h.run();

    expect(result.committed).toBe(true);
    expect(result.lastReceipt).toEqual({ mutationId: "mut-1", revision: 6 });
    expect(h.events.some((e) => e.type === "mutation.committed")).toBe(true);
  });

  it("F04 防线：工具没有回执时**不得**声称已保存", async () => {
    const h = harness({
      parts: [
        { type: "tool-input-start", toolCallId: "c1", toolName: "updateBasicsBlock" },
        { type: "tool-call", toolCallId: "c1", toolName: "updateBasicsBlock", input: {} },
        { type: "finish" },
      ],
      // 工具说成功，但没有 mutationId/revision —— 即没有真正落盘。
      toolOutcome: { status: "succeeded", result: { applied: true } },
    });
    const result = await h.run();

    expect(result.committed).toBe(false);
    expect(result.lastReceipt).toBeNull();
    expect(h.events.some((e) => e.type === "mutation.committed")).toBe(false);
  });

  it("工具失败记为 tool.failed 而不是 completed", async () => {
    const h = harness({
      parts: [
        { type: "tool-input-start", toolCallId: "c1", toolName: "readResume" },
        { type: "tool-call", toolCallId: "c1", toolName: "readResume", input: {} },
        { type: "finish" },
      ],
      toolOutcome: { status: "failed", code: "not_found", message: "找不到区块" },
    });
    const result = await h.run();

    const failed = h.events.find((e) => e.type === "tool.failed");
    expect(failed?.payload.code).toBe("not_found");
    expect(result.tools).toEqual([{ toolName: "readResume", status: "failed" }]);
  });

  it("提案式工具发 proposal.ready（批准模式下不直接提交）", async () => {
    const h = harness({
      parts: [
        { type: "tool-input-start", toolCallId: "c1", toolName: "updateBasicsBlock" },
        { type: "tool-call", toolCallId: "c1", toolName: "updateBasicsBlock", input: {} },
        { type: "finish" },
      ],
      toolOutcome: {
        status: "proposed",
        changeSetId: "cs-1",
        proposalVersion: 1,
        operations: [],
        summary: "更新基础信息",
      },
    });
    const result = await h.run({ writeMode: "approval" });

    expect(h.events.some((e) => e.type === "proposal.ready")).toBe(true);
    expect(result.committed).toBe(false);
  });

  it("askUser 产出的 waiting_user 不被第二个结束事件覆盖", async () => {
    const h = harness({
      parts: [
        { type: "tool-input-start", toolCallId: "c1", toolName: "askUser" },
        { type: "tool-call", toolCallId: "c1", toolName: "askUser", input: {} },
        { type: "finish" },
      ],
      toolOutcome: {
        status: "asked",
        question: { questionId: "q1", question: "这段是主导还是参与？" },
      },
    });
    const result = await h.run();

    const endEvents = h.events.filter((e) =>
      ["run.waiting_user", "run.interrupted", "run.completed", "run.failed", "run.cancelled"].includes(e.type),
    );
    expect(endEvents).toHaveLength(1);
    expect(result.endType).toBe("run.waiting_user");
  });
});

describe("编排：取消与 fencing", () => {
  it("取消后不再执行工具（提交前核验拦下）", async () => {
    const executed: string[] = [];
    const h = harness({
      parts: [
        { type: "tool-input-start", toolCallId: "c1", toolName: "updateBasicsBlock" },
        { type: "tool-call", toolCallId: "c1", toolName: "updateBasicsBlock", input: {} },
        { type: "finish" },
      ],
      writable: false,
      cancelled: true,
    });
    // 记录工具是否被执行
    const originalExecute = h.deps.executeTool;
    h.deps.executeTool = async (input) => {
      executed.push(input.toolName);
      return originalExecute(input);
    };

    const result = await h.run();

    expect(executed).toEqual([]);
    expect(result.committed).toBe(false);
    expect(h.events.some((e) => e.type === "tool.failed" && e.payload.code === "run_not_writable")).toBe(true);
    expect(result.endType).toBe("run.cancelled");
  });

  it("取消优先于完成（点了取消不能显示完成）", async () => {
    const h = harness({ parts: [{ type: "finish" }], cancelled: true, waitForUser: true });
    const result = await h.run();
    expect(result.endType).toBe("run.cancelled");
  });

  it("工具产生提案后崩溃 → 明确 failed，且没有提交", async () => {
    const h = harness({
      parts: [
        { type: "tool-input-start", toolCallId: "c1", toolName: "updateBasicsBlock" },
        { type: "tool-call", toolCallId: "c1", toolName: "updateBasicsBlock", input: {} },
        { type: "text-delta", text: "。" },
      ],
      toolOutcome: {
        status: "proposed",
        changeSetId: "cs-1",
        proposalVersion: 1,
        operations: [],
        summary: "x",
      },
      throwAt: 3,
    });
    const result = await h.run();

    expect(result.endType).toBe("run.failed");
    expect(result.committed).toBe(false);
  });

  it("commit 后发送前断线：已提交的结果保留（不回滚）", async () => {
    const h = harness({
      parts: [
        { type: "tool-input-start", toolCallId: "c1", toolName: "updateBasicsBlock" },
        { type: "tool-call", toolCallId: "c1", toolName: "updateBasicsBlock", input: {} },
        { type: "text-delta", text: "已经保存好了" },
      ],
      toolOutcome: { status: "succeeded", result: {}, mutationId: "mut-9", revision: 7 },
      throwAt: 3,
    });
    const result = await h.run();

    // 提交已发生 → 保留结论；但 attempt 因断线判为 failed。
    expect(result.committed).toBe(true);
    expect(result.lastReceipt?.mutationId).toBe("mut-9");
    expect(h.events.some((e) => e.type === "mutation.committed")).toBe(true);
    expect(result.endType).toBe("run.failed");
  });
});

describe("编排：EOF 与预算", () => {
  it("没有 finish 的 EOF 判为 interrupted（不假称完成）", async () => {
    const h = harness({
      // 有文本但**没有 finish**、没有错误 —— 典型的连接被截断。
      parts: [{ type: "text-delta", text: "已经帮你改好了" }],
    });
    const result = await h.run();

    expect(result.endType).toBe("run.interrupted");
    const endEvent = h.events.find((e) => e.type === "run.interrupted");
    expect(endEvent?.payload.reason).toContain("中断");
  });

  it("有 finish 才算正常完成", async () => {
    const h = harness({ parts: [{ type: "text-delta", text: "完成" }, { type: "finish" }] });
    const result = await h.run();
    expect(result.endType).toBe("run.completed");
  });

  it("超出时间预算时中断，不假装完成", async () => {
    let clock = 0;
    const h = harness({ parts: [{ type: "text-delta", text: "慢" }, { type: "text-delta", text: "慢" }] });
    h.deps.now = () => (clock += 100_000);
    const result = await h.run({ budget: { maxSteps: 6, deadlineMs: 1000 } });

    expect(result.endType).toBe("run.interrupted");
    expect(h.events.some((e) => e.type === "run.interrupted")).toBe(true);
  });

  it("流式异常被如实记录为 failed", async () => {
    // 必须在**流中途**抛错：此前写成「只有 1 个片段 + throwAt: 2」，
    // 那个异常根本不会触发，测试实际验证的是 EOF 截断（结论不同）。
    const h = harness({
      parts: [{ type: "text-delta", text: "x" }, { type: "text-delta", text: "y" }],
      throwAt: 2,
    });
    const result = await h.run();
    expect(result.endType).toBe("run.failed");
  });
});

describe("工具是否真的改动了文档", () => {
  it("只有带回执的成功才算改动", () => {
    expect(
      toolTouchedDocument({ status: "succeeded", result: {}, mutationId: "m", revision: 1 }),
    ).toBe(true);
    // 没有回执 = 没落盘
    expect(toolTouchedDocument({ status: "succeeded", result: {} })).toBe(false);
    expect(toolTouchedDocument({ status: "failed", code: "x", message: "y" })).toBe(false);
    expect(
      toolTouchedDocument({
        status: "proposed",
        changeSetId: "cs",
        proposalVersion: 1,
        operations: [],
        summary: "",
      }),
    ).toBe(false);
  });
});

describe("复核发现（回归测试）", () => {
  it("【P0】askUser 之后**不得**再执行写工具并落库", async () => {
    /*
     * 真实缺陷：`case "asked"` 只 break 了 switch，随即 continue 消费同一个流。
     * 模型在同一 attempt 内先 askUser 再发起写工具是完全可能的，此时用户尚未回答，
     * 文档却已被修改 —— 而 endType 仍是 waiting_user，UI 显示「等待你回答」。
     */
    const executed: string[] = [];
    const h = harness({
      parts: [
        { type: "tool-input-start", toolCallId: "c1", toolName: "askUser" },
        { type: "tool-call", toolCallId: "c1", toolName: "askUser", input: {} },
        { type: "tool-input-start", toolCallId: "c2", toolName: "updateBasicsBlock" },
        { type: "tool-call", toolCallId: "c2", toolName: "updateBasicsBlock", input: { name: "李四" } },
        { type: "finish" },
      ],
      toolOutcome: (name) =>
        name === "askUser"
          ? { status: "asked", question: { questionId: "q1", question: "这是主导还是参与？" } }
          : { status: "succeeded", result: {}, mutationId: "mut-1", revision: 6 },
    });
    const originalExecute = h.deps.executeTool;
    h.deps.executeTool = async (input) => {
      executed.push(input.toolName);
      return originalExecute(input);
    };

    const result = await h.run();

    // 关键：进入等待用户后，写工具不得被执行、也不得有提交。
    expect(executed).toEqual(["askUser"]);
    expect(result.committed).toBe(false);
    expect(result.lastReceipt).toBeNull();
    expect(h.events.some((e) => e.type === "mutation.committed")).toBe(false);
    expect(result.endType).toBe("run.waiting_user");
  });

  it("【P1】已发出结束事件后遭遇取消：返回值必须与事件流一致", async () => {
    /*
     * 真实缺陷：`sawEndEvent === true` 且随后取消时，函数把 endType 覆写成
     * run.cancelled 却**不再发事件**。服务端若按 endType 落库、客户端按事件投影，
     * 两端会对同一 attempt 得出不同结论。
     */
    let cancelled = false;
    const h = harness({
      parts: [
        { type: "tool-input-start", toolCallId: "c1", toolName: "askUser" },
        { type: "tool-call", toolCallId: "c1", toolName: "askUser", input: {} },
      ],
      toolOutcome: { status: "asked", question: { questionId: "q1", question: "问一句" } },
    });
    const originalExecute = h.deps.executeTool;
    h.deps.executeTool = async (input) => {
      const outcome = await originalExecute(input);
      // 工具执行后立刻取消（模拟取消与结束竞争）。
      cancelled = true;
      return outcome;
    };
    h.deps.isCancelled = () => cancelled;

    const result = await h.run();

    // 事件流里必须存在与返回值同类型的结束事件。
    const hasMatchingEvent = h.events.some((e) => e.type === result.endType);
    expect(
      hasMatchingEvent,
      `返回值 ${result.endType} 在事件流里没有对应事件（流里只有 ${h.events
        .map((e) => e.type)
        .join(" -> ")}）`,
    ).toBe(true);
  });
});
