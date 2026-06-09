import { describe, expect, it } from "vitest";

import {
  isAllowedPatchFieldPath,
  validateAgentToolOutput,
} from "../src/agent-tools";

describe("agent tools", () => {
  it("allows only basic resume modification field paths", () => {
    expect(isAllowedPatchFieldPath("basics.summary")).toBe(true);
    expect(isAllowedPatchFieldPath("experience.0.content")).toBe(true);
    expect(isAllowedPatchFieldPath("projects.2.content")).toBe(true);
    expect(isAllowedPatchFieldPath("education.1.highlights")).toBe(true);
    expect(isAllowedPatchFieldPath("research.0.content")).toBe(true);
    expect(isAllowedPatchFieldPath("skills")).toBe(true);
    expect(isAllowedPatchFieldPath("custom.0.content")).toBe(true);

    expect(isAllowedPatchFieldPath("templateId")).toBe(false);
    expect(isAllowedPatchFieldPath("isPublic")).toBe(false);
    expect(isAllowedPatchFieldPath("experience.0.company")).toBe(false);
    expect(isAllowedPatchFieldPath("__proto__.polluted")).toBe(false);
  });

  it("validates proposed patches without allowing direct writes", () => {
    const result = validateAgentToolOutput({
      toolCalls: [
        {
          id: "tool_1",
          name: "propose_rich_text_rewrite",
          status: "completed",
          title: "优化经历",
          summary: "将笼统描述改成 STAR 结构。",
          input: { fieldPath: "experience.0.content" },
          result: { patchIds: ["patch_1"] },
        },
      ],
      proposedPatches: [
        {
          id: "patch_1",
          toolCallId: "tool_1",
          label: "应用 STAR 改写",
          section: "experience",
          fieldPath: "experience.0.content",
          operation: "replace_tiptap_json",
          beforePlainText: "负责后台系统开发。",
          afterPlainText:
            "围绕后台系统稳定性目标，梳理前端问题并推进优化；结果指标需要补充。",
          replacementTiptapJson: { type: "doc", content: [] },
          changeSummary: "补足任务与行动，不编造结果。",
          riskFlags: [{ type: "needs_user_fact", message: "请补充结果指标。" }],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      output: {
        toolCalls: [expect.objectContaining({ id: "tool_1" })],
        proposedPatches: [expect.objectContaining({ id: "patch_1" })],
      },
    });
  });

  it("rejects patches that target non-editable fields", () => {
    const result = validateAgentToolOutput({
      toolCalls: [
        {
          id: "tool_1",
          name: "propose_summary_rewrite",
          status: "completed",
          title: "改写标题",
          summary: "不允许改写模板或标题。",
          input: {},
          result: {},
        },
      ],
      proposedPatches: [
        {
          id: "patch_1",
          toolCallId: "tool_1",
          label: "改模板",
          section: "summary",
          fieldPath: "templateId",
          operation: "replace_plain_text",
          beforePlainText: "professional",
          afterPlainText: "modern",
          changeSummary: "不允许。",
          riskFlags: [],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      message: "patch.fieldPath is not allowed",
    });
  });
});
