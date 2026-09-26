import { describe, expect, it } from "vitest";
import { ResumeContent, emptyResumeContent } from "@intro-builder/shared/schemas";
import type { RunEventType } from "@intro-builder/shared/types";

import { orchestrateRun, type RunDeps, type ToolExecutionResult } from "@/lib/ai/run";
import type { BusinessEventDraft, SdkStreamPart } from "@/lib/ai/stream-adapter";
import { resolveIntent } from "@/lib/ai/prompts/intent";
import { INTENT_CONSTRAINTS } from "@/lib/ai/prompts/intent";

/**
 * 五个场景的**行为**验证（P05 任务 3）。
 *
 * plan 要求「对『诊断』『润色』『目标岗位』『缺事实』『拒绝后继续』各做行为红→绿；
 * 工具错误时返回真实状态而不编造结果」。
 *
 * 「行为」在这里有明确含义：不是断言提示词里有没有某句话，而是断言
 * **编排层真的做了什么** —— 有没有产出文档修改、有没有结束本轮等用户、
 * 失败时有没有如实回报。判据取自 spec §4 的「允许的输出 / 禁止的行为」表。
 *
 * 关键点：**只有拿到真实回执才算改了文档**。因此每个场景都要检查
 * `mutation.committed` 事件是否存在，而不是看模型说了什么。
 */

function doc(text: string) {
  return { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function content(): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    experience: [
      { id: "exp-a", company: "甲公司", title: "前端", start: "", end: "", location: "", content: doc("参与订单系统开发。") },
    ],
    sectionOrder: ["basics", "experience", "skills"],
  });
}

type ScenarioOptions = {
  parts: SdkStreamPart[];
  toolOutcome?: ToolExecutionResult;
  writeMode?: "direct" | "approval";
  message?: string;
};

type ScenarioResult = {
  endType: RunEventType;
  events: BusinessEventDraft[];
  committed: boolean;
  tools: Array<{ toolName: string; status: string }>;
  /** 是否发生了文档写入（依据真实回执，不是模型的话）。 */
  documentWritten: boolean;
  /** 是否进入了等待用户。 */
  waitedForUser: boolean;
};

async function runScenario(options: ScenarioOptions): Promise<ScenarioResult> {
  const events: BusinessEventDraft[] = [];

  const deps: RunDeps = {
    loadWorkspaceSource: async () => ({
      content: content(),
      revision: 3,
      title: "简历",
      templateId: "classic",
    }),
    streamModel: () =>
      (async function* () {
        for (const part of options.parts) yield part;
      })(),
    executeTool: async () => options.toolOutcome ?? { status: "succeeded", result: { ok: true } },
    emitEvent: async (draft) => {
      events.push(draft);
    },
    isWritable: async () => true,
    isCancelled: () => false,
    shouldWaitForUser: () => false,
    buildSystemPrompt: () => "system",
    buildMessages: () => [{ role: "user", content: options.message ?? "" }],
    buildTools: () => ({ readResume: {}, updateWorkExperienceBlock: {} }),
  };

  const result = await orchestrateRun(deps, {
    runId: "run-1",
    resumeId: "resume-1",
    userId: "user-1",
    attemptId: "attempt-1",
    writeMode: options.writeMode ?? "direct",
    fenceToken: 1,
    abortSignal: new AbortController().signal,
  });

  const mutationCommitted = events.some((event) => event.type === "mutation.committed");

  return {
    endType: result.endType,
    events,
    committed: result.committed,
    tools: result.tools,
    documentWritten: mutationCommitted,
    waitedForUser: result.endType === "run.waiting_user",
  };
}

/** 一次「模型调用工具」的最小流：tool-call + finish。 */
function toolCallStream(toolName: string, input: Record<string, unknown> = {}): SdkStreamPart[] {
  return [
    { type: "tool-call", toolCallId: "call-1", toolName, input },
    { type: "finish", finishReason: "tool-calls" },
  ];
}

describe("场景一：诊断（只读，不写文档）", () => {
  it("意图识别为 diagnose", () => {
    expect(resolveIntent({ message: "帮我看看简历有什么问题" })).toBe("diagnose");
  });

  it("意图约束明确禁止顺手重写整份简历", () => {
    expect(INTENT_CONSTRAINTS.diagnose.forbidden).toContain("重写整份简历");
  });

  it("只读工具不产生文档写入", async () => {
    const result = await runScenario({
      parts: toolCallStream("readResume", { section: "experience" }),
      toolOutcome: { status: "succeeded", result: { sections: [] } },
    });
    // 关键行为：诊断不发生文档提交。
    expect(result.documentWritten).toBe(false);
    expect(result.committed).toBe(false);
  });

  it("诊断不因缺少回执而报成已保存", async () => {
    const result = await runScenario({
      parts: toolCallStream("readResume"),
      toolOutcome: { status: "succeeded", result: {} },
    });
    expect(result.events.some((event) => event.type === "mutation.committed")).toBe(false);
  });
});

describe("场景二：润色（产出提案，不伪造保存）", () => {
  it("意图识别为 rewrite", () => {
    expect(resolveIntent({ message: "帮我把这段润色一下" })).toBe("rewrite");
  });

  it("有真实回执时才算写入（mutation.committed 存在）", async () => {
    const result = await runScenario({
      parts: toolCallStream("updateWorkExperienceBlock", { itemId: "exp-a" }),
      toolOutcome: {
        status: "succeeded",
        result: { saved: true },
        mutationId: "m-1",
        revision: 4,
      },
    });
    expect(result.documentWritten).toBe(true);
    expect(result.committed).toBe(true);
  });

  it("**工具声称改了但无回执 → 不算已保存**（这是最容易出错的一处）", async () => {
    const result = await runScenario({
      parts: toolCallStream("updateWorkExperienceBlock", { itemId: "exp-a" }),
      // 没有 mutationId / revision 的「成功」不构成落盘依据。
      toolOutcome: { status: "succeeded", result: { saved: true } },
    });
    expect(result.documentWritten).toBe(false);
    expect(result.committed).toBe(false);
  });

  it("审批模式下产出提案而不写入", async () => {
    const result = await runScenario({
      parts: toolCallStream("updateWorkExperienceBlock", { itemId: "exp-a" }),
      writeMode: "approval",
      toolOutcome: {
        status: "proposed",
        changeSetId: "cs-1",
        proposalVersion: 1,
        operations: [],
        summary: "润色项目描述",
      },
    });
    expect(result.documentWritten).toBe(false);
    expect(result.events.some((event) => event.type === "proposal.ready")).toBe(true);
  });
});

describe("场景三：目标岗位（只指出缺口，不改技能）", () => {
  it("意图识别为 role_match", () => {
    expect(resolveIntent({ message: "帮我看看和这个岗位的匹配度" })).toBe("role_match");
  });

  it("意图约束禁止从 JD 复制技术进入用户技能", () => {
    expect(INTENT_CONSTRAINTS.role_match.forbidden).toContain("JD");
    expect(INTENT_CONSTRAINTS.role_match.forbidden).toContain("技能");
  });

  it("岗位匹配只读时不写文档", async () => {
    const result = await runScenario({
      parts: toolCallStream("readResume", { section: "skills" }),
      toolOutcome: { status: "succeeded", result: { skills: "MySQL" } },
    });
    expect(result.documentWritten).toBe(false);
  });
});

describe("场景四：缺事实（追问并结束本轮）", () => {
  it("简短的补充回答识别为 fact_intake", () => {
    expect(resolveIntent({ message: "是的" })).toBe("fact_intake");
  });

  it("意图约束禁止一次抛十几项表单", () => {
    expect(INTENT_CONSTRAINTS.fact_intake.forbidden).toContain("十几项");
  });

  it("askUser 后结束本轮为 waiting_user，且不写文档", async () => {
    const result = await runScenario({
      parts: [
        { type: "tool-call", toolCallId: "call-1", toolName: "askUser", input: { question: "这个项目的量化结果是什么？" } },
        { type: "finish", finishReason: "tool-calls" },
      ],
      /*
       * askUser 必须以 `asked` 状态返回（不是 `succeeded`）。
       * 编排层据此发出 run.waiting_user 并**跳出流消费** ——
       * 若返回 succeeded，模型在 askUser 之后发起的写工具也会被执行，
       * 用户还没回答文档就已经被改。
       */
      toolOutcome: {
        status: "asked",
        question: { questionId: "q-1", question: "这个项目的量化结果是什么？" },
      },
    });

    // 关键行为：追问必须结束本轮，而不是继续执行后面的写工具。
    expect(result.waitedForUser).toBe(true);
    expect(result.documentWritten).toBe(false);
  });
});

describe("场景五：拒绝后继续（失败如实回报）", () => {
  it("工具失败时发出 tool.failed 而不是假装成功", async () => {
    const result = await runScenario({
      parts: toolCallStream("updateWorkExperienceBlock", { itemId: "exp-a" }),
      toolOutcome: { status: "failed", code: "target_not_found", message: "找不到条目" },
    });

    const failed = result.events.find((event) => event.type === "tool.failed");
    expect(failed).toBeDefined();
    // 如实带出原因，便于模型改对（而不是只说「失败了」）。
    expect((failed?.payload as { code?: string }).code).toBe("target_not_found");
    expect(result.documentWritten).toBe(false);
  });

  it("工具失败时不产生 mutation.committed", async () => {
    const result = await runScenario({
      parts: toolCallStream("updateWorkExperienceBlock", { itemId: "nope" }),
      toolOutcome: { status: "failed", code: "target_not_found", message: "找不到条目" },
    });
    expect(result.documentWritten).toBe(false);
    expect(result.committed).toBe(false);
  });

  it("**提交前被取消 → 不执行工具**（避免已取消的 Run 继续写库）", async () => {
    let executed = 0;
    const events: BusinessEventDraft[] = [];

    const deps: RunDeps = {
      loadWorkspaceSource: async () => ({
        content: content(),
        revision: 3,
        title: "简历",
        templateId: "classic",
      }),
      streamModel: () =>
        (async function* () {
          yield { type: "tool-call", toolCallId: "call-1", toolName: "updateWorkExperienceBlock", input: {} };
          yield { type: "finish", finishReason: "tool-calls" };
        })(),
      executeTool: async () => {
        executed += 1;
        return { status: "succeeded", result: {} };
      },
      emitEvent: async (draft) => {
        events.push(draft);
      },
      // 编排层在真正执行工具**之前**会核验一次可写性。
      isWritable: async () => false,
      isCancelled: () => false,
      shouldWaitForUser: () => false,
      buildSystemPrompt: () => "system",
      buildMessages: () => [],
      buildTools: () => ({}),
    };

    await orchestrateRun(deps, {
      runId: "run-1",
      resumeId: "resume-1",
      userId: "user-1",
      attemptId: "attempt-1",
      writeMode: "direct",
      fenceToken: 1,
      abortSignal: new AbortController().signal,
    });

    expect(executed).toBe(0);
  });

  it("被拒绝后仍继续处理其他内容（不因一次失败终止整轮）", async () => {
    const result = await runScenario({
      parts: [
        { type: "tool-call", toolCallId: "call-1", toolName: "readResume", input: {} },
        { type: "tool-call", toolCallId: "call-2", toolName: "updateWorkExperienceBlock", input: { itemId: "exp-a" } },
        { type: "finish", finishReason: "tool-calls" },
      ],
      toolOutcome: { status: "failed", code: "target_not_found", message: "找不到条目" },
    });
    // 两次工具都被尝试（失败不中断后续）。
    expect(result.tools.length).toBe(2);
  });
});
