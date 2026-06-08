import { describe, expect, it } from "vitest";

import {
  buildAgentMessagePrompt,
  parseAgentMessageProviderResponse,
  validateAgentMessageRequest,
} from "../src/agent-messages";

describe("agent messages", () => {
  it("validates an Agent message request", () => {
    const result = validateAgentMessageRequest(validBody());

    expect(result).toMatchObject({
      ok: true,
      request: {
        resumeId: "resume_abc",
        locale: "zh-CN",
        workflowId: "resume-diagnose",
        messages: [{ role: "user", content: "诊断整份简历" }],
        context: {
          resumeTitle: "前端开发工程师",
          templateId: "professional",
          sections: [
            {
              fieldPath: "experience.0.content",
              plainText: "负责业务系统前端开发，优化页面性能。",
            },
          ],
        },
      },
    });
  });

  it("rejects contexts that exceed the plain text limit", () => {
    const result = validateAgentMessageRequest(
      validBody({
        context: {
          ...validBody().context,
          sections: [
            {
              key: "experience",
              label: "工作经历 1",
              fieldPath: "experience.0.content",
              plainText: "x".repeat(12_001),
            },
          ],
        },
      }),
    );

    expect(result).toEqual({
      ok: false,
      statusCode: 413,
      error: "payload_too_large",
      message: "context plain text must be at most 12000 characters",
    });
  });

  it("builds a prompt that exposes tool names and STAR safety rules", () => {
    const result = validateAgentMessageRequest(validBody());
    if (!result.ok) throw new Error("expected valid request");

    const prompt = buildAgentMessagePrompt({
      ...result.request,
      requestId: "req_agent",
    });

    expect(prompt.system).toContain("intro-builder 的简历 Agent");
    expect(prompt.developer).toContain(
      "可用 tools: inspect_resume, propose_rich_text_rewrite, propose_summary_rewrite, propose_bullet_rewrite, draft_section_item",
    );
    expect(prompt.developer).toContain("所有简历修改必须作为 proposedPatches 返回");
    expect(prompt.developer).toContain("使用 STAR 原则时，不得编造 Result 指标");
    expect(prompt.user).toContain("workflowId: resume-diagnose");
    expect(prompt.user).toContain("experience.0.content");
  });

  it("parses provider response with tool calls and proposed patches", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "建议先优化工作经历。",
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "inspect_resume",
            status: "completed",
            title: "检查简历",
            summary: "发现工作经历缺少结果。",
            input: { scope: "resume" },
            result: { topIssue: "缺少结果" },
          },
        ],
        proposedPatches: [],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: {
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "建议先优化工作经历。",
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "inspect_resume",
            status: "completed",
            title: "检查简历",
            summary: "发现工作经历缺少结果。",
            input: { scope: "resume" },
            result: { topIssue: "缺少结果" },
          },
        ],
        proposedPatches: [],
      },
    });
  });
});

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN",
    workflowId: "resume-diagnose",
    messages: [{ id: "msg_user_1", role: "user", content: "诊断整份简历" }],
    context: {
      resumeTitle: "前端开发工程师",
      templateId: "professional",
      activeSection: null,
      completeness: {
        overall: 80,
        sections: [{ key: "experience", label: "工作经历", score: 18, max: 25 }],
      },
      sections: [
        {
          key: "experience",
          label: "工作经历 1",
          fieldPath: "experience.0.content",
          plainText: "负责业务系统前端开发，优化页面性能。",
        },
      ],
    },
    ...overrides,
  };
}
