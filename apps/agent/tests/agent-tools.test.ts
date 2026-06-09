import { describe, expect, it } from "vitest";

import {
  isAllowedOperationFieldPath,
  validateAgentToolOutput,
} from "../src/agent-tools";

describe("agent tools", () => {
  it("allows only basic resume operation field paths", () => {
    expect(isAllowedOperationFieldPath("basics.summary")).toBe(true);
    expect(isAllowedOperationFieldPath("experience.0.content")).toBe(true);
    expect(isAllowedOperationFieldPath("projects.2.content")).toBe(true);
    expect(isAllowedOperationFieldPath("education.1.highlights")).toBe(true);
    expect(isAllowedOperationFieldPath("research.0.content")).toBe(true);
    expect(isAllowedOperationFieldPath("skills")).toBe(true);
    expect(isAllowedOperationFieldPath("custom.0.content")).toBe(true);
    expect(isAllowedOperationFieldPath("sectionOrder")).toBe(true);

    expect(isAllowedOperationFieldPath("templateId")).toBe(false);
    expect(isAllowedOperationFieldPath("isPublic")).toBe(false);
    expect(isAllowedOperationFieldPath("experience.0.company")).toBe(false);
    expect(isAllowedOperationFieldPath("__proto__.polluted")).toBe(false);
  });

  it("validates minimal resume operations without allowing direct writes", () => {
    const result = validateAgentToolOutput({
      toolCalls: [
        {
          id: "tool_1",
          name: "resume_update_section",
          status: "completed",
          title: "优化经历",
          summary: "更新工作经历富文本。",
          input: { fieldPath: "experience.0.content" },
          result: { operationIds: ["op_1"] },
        },
        {
          id: "tool_2",
          name: "resume_reorder_sections",
          status: "completed",
          title: "调整模块顺序",
          summary: "把项目经历移动到工作经历之后。",
          input: { sectionOrder: ["basics", "experience", "projects", "education", "skills"] },
          result: { operationIds: ["op_2"] },
        },
      ],
      proposedOperations: [
        {
          id: "op_1",
          toolCallId: "tool_1",
          label: "应用 STAR 改写",
          section: "experience",
          fieldPath: "experience.0.content",
          operation: "update_section",
          beforePlainText: "负责后台系统开发。",
          afterPlainText:
            "围绕后台系统稳定性目标，梳理前端问题并推进优化；结果指标需要补充。",
          replacementTiptapJson: { type: "doc", content: [] },
          changeSummary: "补足任务与行动，不编造结果。",
          riskFlags: [{ type: "needs_user_fact", message: "请补充结果指标。" }],
        },
        {
          id: "op_2",
          toolCallId: "tool_2",
          label: "应用模块顺序",
          section: "custom",
          fieldPath: "sectionOrder",
          operation: "reorder_sections",
          beforePlainText: "basics,experience,education,projects,skills",
          afterPlainText: "basics,experience,projects,education,skills",
          sectionOrder: ["basics", "experience", "projects", "education", "skills"],
          changeSummary: "项目经历前置，方便目标岗位匹配。",
          riskFlags: [],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      output: {
        toolCalls: [
          expect.objectContaining({ id: "tool_1" }),
          expect.objectContaining({ id: "tool_2" }),
        ],
        proposedOperations: [
          expect.objectContaining({ id: "op_1", operation: "update_section" }),
          expect.objectContaining({ id: "op_2", operation: "reorder_sections" }),
        ],
      },
    });
  });

  it("rejects deprecated proposal tools", () => {
    const result = validateAgentToolOutput({
      toolCalls: [
        {
          id: "tool_1",
          name: "propose_summary_rewrite",
          status: "completed",
          title: "旧工具",
          summary: "旧工具应被拒绝。",
          input: {},
          result: {},
        },
      ],
      proposedOperations: [],
    });

    expect(result).toEqual({
      ok: false,
      message: "toolCall.name is not supported",
    });
  });

  it("rejects operations that target non-editable fields", () => {
    const result = validateAgentToolOutput({
      toolCalls: [
        {
          id: "tool_1",
          name: "resume_update_section",
          status: "completed",
          title: "改写标题",
          summary: "不允许改写模板或标题。",
          input: {},
          result: {},
        },
      ],
      proposedOperations: [
        {
          id: "op_1",
          toolCallId: "tool_1",
          label: "改模板",
          section: "summary",
          fieldPath: "templateId",
          operation: "update_section",
          beforePlainText: "professional",
          afterPlainText: "modern",
          changeSummary: "不允许。",
          riskFlags: [],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      message: "operation.fieldPath is not allowed",
    });
  });

  it("rejects reorder operations that remove basics", () => {
    const result = validateAgentToolOutput({
      toolCalls: [
        {
          id: "tool_1",
          name: "resume_reorder_sections",
          status: "completed",
          title: "调整模块顺序",
          summary: "不允许移除 basics。",
          input: {},
          result: {},
        },
      ],
      proposedOperations: [
        {
          id: "op_1",
          toolCallId: "tool_1",
          label: "移除 basics",
          section: "summary",
          fieldPath: "sectionOrder",
          operation: "reorder_sections",
          beforePlainText: "basics,experience",
          afterPlainText: "experience",
          sectionOrder: ["experience"],
          changeSummary: "不允许。",
          riskFlags: [],
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      message: "operation.sectionOrder must include basics",
    });
  });
});
