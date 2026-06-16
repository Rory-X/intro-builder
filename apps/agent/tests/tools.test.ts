import { describe, expect, it } from "vitest";

import { createDraft } from "../src/workflows/draft";
import { computeCompleteness, createLoopTools } from "../src/workflows/tools";

type ToolExec<I> = (input: I, options: { toolCallId: string }) => Promise<unknown>;

function exec<I>(tool: { execute?: unknown }, input: I, toolCallId: string) {
  return (tool.execute as ToolExec<I>)(input, { toolCallId });
}

describe("create-from-zero loop tools", () => {
  it("resume_read returns the current (initially empty) draft", async () => {
    const draft = createDraft({ targetRole: "后端工程师" });
    const tools = createLoopTools(draft);
    const result = (await exec(tools.resume_read, {}, "call_read")) as {
      targetRole: string | null;
      sections: unknown[];
    };
    expect(result.targetRole).toBe("后端工程师");
    expect(result.sections).toHaveLength(0);
  });

  it("upsert_section writes to the draft and reports the operation kind", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    const result = (await exec(
      tools.upsert_section,
      {
        section: "experience",
        fieldPath: "experience.0.content",
        label: "后端工程师 · 蜂鸟科技",
        afterPlainText: "主导订单系统 Go 重构，P99 延迟下降 42%。",
      },
      "call_1",
    )) as { ok: boolean; operation?: string };

    expect(result.ok).toBe(true);
    expect(result.operation).toBe("insert_section");
    expect(draft.operations).toHaveLength(1);
    expect(draft.toolCalls[0].id).toBe("call_1");
  });

  it("upsert_section rejects a disallowed field path without mutating the draft", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    const result = (await exec(
      tools.upsert_section,
      {
        section: "experience",
        fieldPath: "experience.nope",
        label: "x",
        afterPlainText: "y",
      },
      "call_1",
    )) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(draft.operations).toHaveLength(0);
  });

  it("get_completeness reflects what has been drafted so far", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    await exec(
      tools.upsert_section,
      {
        section: "summary",
        fieldPath: "basics.summary",
        label: "个人简介",
        afterPlainText: "三年后端经验。",
      },
      "call_1",
    );

    const before = computeCompleteness(draft);
    expect(before.overall).toBe(25); // 1 of 4 targets
    expect(before.missing).toContain("工作经历");

    const result = (await exec(tools.get_completeness, {}, "call_2")) as {
      overall: number;
      missing: string[];
    };
    expect(result.overall).toBe(25);
  });

  it("set_goal records title and target role", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    await exec(
      tools.set_goal,
      { title: "后端工程师简历", targetRole: "后端工程师" },
      "call_1",
    );
    expect(draft.title).toBe("后端工程师简历");
    expect(draft.targetRole).toBe("后端工程师");
  });
});
