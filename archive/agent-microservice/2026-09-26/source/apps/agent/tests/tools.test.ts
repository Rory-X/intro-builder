import { describe, expect, it } from "vitest";

import { createDraft } from "../src/workflows/draft";
import { computeCompleteness, createLoopTools } from "../src/workflows/tools";

type ToolExec<I> = (
  input: I,
  options: { toolCallId: string },
) => Promise<unknown>;

function exec<I>(
  tool: { execute?: unknown },
  input: I,
  toolCallId: string,
) {
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

  it("resume_update_section writes to the draft and reports the operation kind", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft, {
      setTextFn: async (_fp, plainText) => ({
        tiptapJson: plainTextToDoc(plainText),
      }),
    });
    const result = (await exec(
      tools.resume_update_section,
      {
        fieldPath: "experience.0.content",
        label: "后端工程师 · 蜂鸟科技",
        newContent: docWithText("主导订单系统 Go 重构，P99 延迟下降 42%。"),
      },
      "call_1",
    )) as { ok: boolean; operation?: { operation: string } };

    expect(result.ok).toBe(true);
    expect(result.operation?.operation).toBe("insert_section");
    expect(draft.operations).toHaveLength(1);
    expect(draft.toolCalls[0].id).toBe("call_1");
  });

  it("resume_update_section rejects a disallowed field path without mutating the draft", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    const result = (await exec(
      tools.resume_update_section,
      {
        fieldPath: "experience.nope",
        label: "x",
        newContent: docWithText("y"),
      },
      "call_1",
    )) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(draft.operations).toHaveLength(0);
  });

  it("get_completeness reflects what has been drafted so far", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft, {
      setTextFn: async (_fp, plainText) => ({
        tiptapJson: plainTextToDoc(plainText),
      }),
    });
    await exec(
      tools.resume_update_section,
      {
        fieldPath: "basics.summary",
        label: "个人简介",
        newContent: docWithText("三年后端经验。"),
      },
      "call_1",
    );

    const before = computeCompleteness(draft);
    expect(before.overall).toBe(25); // 1 of 4 targets
    expect(before.missing).toContain("工作经历");

    const result = (await exec(
      tools.get_completeness,
      {},
      "call_2",
    )) as {
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

  it("resume_set_text converts plain text and writes to draft", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft, {
      setTextFn: async (_fp, plainText) => ({
        tiptapJson: plainTextToDoc(plainText),
      }),
    });
    const result = (await exec(
      tools.resume_set_text,
      {
        fieldPath: "basics.summary",
        plainText: "资深后端工程师",
        label: "个人简介",
      },
      "call_set",
    )) as { ok: boolean; operation: { operation: string } };
    expect(result.ok).toBe(true);
    expect(draft.profileSummary).toBe("资深后端工程师");
  });

  it("resume_set_text falls back to built-in TipTap conversion when setTextFn is not configured", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    const result = (await exec(
      tools.resume_set_text,
      {
        fieldPath: "skills",
        plainText: "- Vue\n- React\n- TypeScript\n- Node.js",
        label: "技能",
      },
      "call_set_builtin",
    )) as { ok: boolean; operation?: { operation: string } };
    expect(result.ok).toBe(true);
    expect(result.operation?.operation).toBe("insert_section");
    expect(draft.operations[0].replacementTiptapJson).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Vue" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "React" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "TypeScript" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Node.js" }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("resume_delete_section removes an entry from draft", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft, {
      setTextFn: async (_fp, plainText) => ({
        tiptapJson: plainTextToDoc(plainText),
      }),
    });
    // First add something
    await exec(
      tools.resume_update_section,
      {
        fieldPath: "experience.0.content",
        label: "测试经历",
        newContent: docWithText("test content"),
      },
      "call_add",
    );
    const beforeCount = draft.sections.length;

    const result = (await exec(
      tools.resume_delete_section,
      { fieldPath: "experience.0.content", label: "测试经历" },
      "call_del",
    )) as { ok: boolean; operation: { operation: string } };
    expect(result.ok).toBe(true);
    expect(result.operation.operation).toBe("delete_section");
    expect(draft.sections.length).toBeLessThan(beforeCount);
  });

  it("resume_reorder_sections stores a reorder operation", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    const result = (await exec(
      tools.resume_reorder_sections,
      {
        newOrder: ["basics", "experience", "education", "skills"],
      },
      "call_reorder",
    )) as { ok: boolean; operation: { operation: string } };
    expect(result.ok).toBe(true);
    expect(result.operation.operation).toBe("reorder_sections");
  });

  it("resume_ask calls onAsk callback", async () => {
    let asked = "";
    const draft = createDraft();
    const tools = createLoopTools(draft, {
      onAsk: (q) => {
        asked = q;
      },
    });
    const result = (await exec(
      tools.resume_ask,
      { question: "你的上一家公司名称？", field: "experience.0.company" },
      "call_ask",
    )) as { asked: boolean; question: string; field: string | null };
    expect(result.asked).toBe(true);
    expect(result.question).toBe("你的上一家公司名称？");
    expect(asked).toBe("你的上一家公司名称？");
  });

  it("resume_polish_text calls polishTextFn and writes to draft", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft, {
      polishTextFn: async (_fp, instruction) => ({
        plainText: "polished result",
        tiptapJson: plainTextToDoc("polished result"),
        operationTemplate: {
          beforePlainText: "",
          afterPlainText: "polished result",
        },
      }),
    });
    const result = (await exec(
      tools.resume_polish_text,
      {
        fieldPath: "experience.0.content",
        instruction: "更量化",
        label: "测试经历",
      },
      "call_polish",
    )) as {
      ok: boolean;
      operation: { operation: string };
      beforePlainText?: string;
      afterPlainText?: string;
    };
    expect(result.ok).toBe(true);
    expect(result.afterPlainText).toBe("polished result");
  });

  it("resume_polish_text returns error when polishTextFn not configured", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    const result = (await exec(
      tools.resume_polish_text,
      { fieldPath: "experience.0.content" },
      "call_err",
    )) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("role_match_read reports matched and missing target-role keywords", async () => {
    const draft = createDraft({ targetRole: "前端工程师" });
    const tools = createLoopTools(draft, {
      resumeContext: {
        resumeTitle: "前端工程师",
        templateId: "professional",
        activeSection: null,
        completeness: { overall: 80, sections: [] },
        sections: [
          {
            key: "experience",
            label: "工作经历",
            fieldPath: "experience.0.content",
            plainText: "负责 React 数据看板开发，优化首屏性能。",
          },
        ],
      },
    });

    const result = (await exec(
      tools.role_match_read,
      { keywords: ["React", "TypeScript", "性能"] },
      "call_role_match",
    )) as {
      targetRole: string | null;
      matchedKeywords: string[];
      missingKeywords: string[];
    };

    expect(result.targetRole).toBe("前端工程师");
    expect(result.matchedKeywords).toEqual(["React", "性能"]);
    expect(result.missingKeywords).toEqual(["TypeScript"]);
    expect(draft.operations).toHaveLength(0);
    expect(draft.toolCalls).toContainEqual(
      expect.objectContaining({
        id: "call_role_match",
        name: "role_match_read",
        status: "completed",
      }),
    );
  });

  it("ats_check returns keyword and structure risks without mutating draft", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft, {
      resumeContext: {
        resumeTitle: "前端工程师",
        templateId: "professional",
        activeSection: null,
        completeness: { overall: 50, sections: [] },
        sections: [
          {
            key: "experience",
            label: "工作经历",
            fieldPath: "experience.0.content",
            plainText: "负责业务系统开发。",
          },
        ],
      },
    });

    const result = (await exec(
      tools.ats_check,
      { keywords: ["React", "TypeScript"] },
      "call_ats",
    )) as { score: number; risks: Array<{ code: string; message: string }> };

    expect(result.score).toBeLessThan(100);
    expect(result.risks).toContainEqual(
      expect.objectContaining({ code: "missing_keyword" }),
    );
    expect(draft.operations).toHaveLength(0);
    expect(draft.toolCalls).toContainEqual(
      expect.objectContaining({ id: "call_ats", name: "ats_check" }),
    );
  });

  it("content_claim_audit flags unsupported metrics", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    await exec(
      tools.resume_set_text,
      {
        fieldPath: "experience.0.content",
        plainText: "推动性能优化，提升 50%。",
        label: "工作经历",
      },
      "call_set_claim",
    );

    const result = (await exec(
      tools.content_claim_audit,
      {},
      "call_claim_audit",
    )) as { risks: Array<{ code: string; message: string }> };

    expect(result.risks).toContainEqual(
      expect.objectContaining({ code: "possible_fabrication" }),
    );
  });

  it("layout_fit_check reports overflow risk from draft density", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    await exec(
      tools.resume_set_text,
      {
        fieldPath: "basics.summary",
        plainText: "很长的个人简介".repeat(40),
        label: "个人简介",
      },
      "call_set_long",
    );

    const result = (await exec(
      tools.layout_fit_check,
      { maxCharacters: 80 },
      "call_layout",
    )) as { riskLevel: string; risks: Array<{ code: string }> };

    expect(result.riskLevel).toBe("high");
    expect(result.risks).toContainEqual(
      expect.objectContaining({ code: "content_overflow" }),
    );
  });

  it("section_quality_score scores specificity and credibility", async () => {
    const draft = createDraft();
    const tools = createLoopTools(draft);
    await exec(
      tools.resume_set_text,
      {
        fieldPath: "experience.0.content",
        plainText: "负责开发。",
        label: "工作经历",
      },
      "call_set_quality",
    );

    const result = (await exec(
      tools.section_quality_score,
      { sectionKey: "experience" },
      "call_quality",
    )) as {
      sectionKey: string;
      overall: number;
      dimensions: Record<string, number>;
    };

    expect(result.sectionKey).toBe("experience");
    expect(result.overall).toBeLessThan(80);
    expect(result.dimensions.specificity).toBeLessThan(60);
  });
});

describe("computeCompleteness", () => {
  it("returns 0 for empty draft", () => {
    const draft = createDraft();
    const result = computeCompleteness(draft);
    expect(result.overall).toBe(0);
    expect(result.present).toHaveLength(0);
    expect(result.missing).toHaveLength(4);
  });

  it("returns 100 when all target sections present", () => {
    const draft = createDraft();
    draft.sections = [
      { key: "summary", label: "简介", summary: "x", status: "drafted" as const },
      { key: "experience", label: "经历", summary: "x", status: "drafted" as const },
      { key: "education", label: "教育", summary: "x", status: "drafted" as const },
      { key: "skills", label: "技能", summary: "x", status: "drafted" as const },
    ];
    const result = computeCompleteness(draft);
    expect(result.overall).toBe(100);
    expect(result.missing).toHaveLength(0);
  });
});

function docWithText(text: string) {
  return { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }] };
}

function plainTextToDoc(text: string) {
  return docWithText(text);
}
