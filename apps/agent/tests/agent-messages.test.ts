import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import {
  buildAgentMessagePrompt,
  parseAgentMessageProviderResponse,
  toAgUiAgentEvents,
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

  it("builds a prompt that exposes AG-UI-aligned minimal tool names and STAR safety rules", () => {
    const result = validateAgentMessageRequest(validBody());
    if (!result.ok) throw new Error("expected valid request");

    const prompt = buildAgentMessagePrompt({
      ...result.request,
      requestId: "req_agent",
    });

    expect(prompt.system).toContain("intro-builder 的简历 Agent");
    expect(prompt.developer).toContain(
      "可用 tools: resume_read, resume_update_section, resume_delete_section, resume_reorder_sections, resume_insert_section",
    );
    expect(prompt.developer).toContain("所有简历修改必须作为 proposedOperations 返回");
    expect(prompt.developer).toContain("使用 STAR 原则时，不得编造 Result 指标");
    expect(prompt.developer).toContain("toolCalls: [] 和 proposedOperations: []");
    expect(prompt.user).toContain("workflowId: resume-diagnose");
    expect(prompt.user).toContain("experience.0.content");
  });

  it("parses provider response with tool calls and proposed operations", () => {
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
            name: "resume_read",
            status: "completed",
            title: "检查简历",
            summary: "发现工作经历缺少结果。",
            input: { scope: "resume" },
            result: { topIssue: "缺少结果" },
          },
        ],
        proposedOperations: [],
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
            name: "resume_read",
            status: "completed",
            title: "检查简历",
            summary: "发现工作经历缺少结果。",
            input: { scope: "resume" },
            result: { topIssue: "缺少结果" },
          },
        ],
        proposedOperations: [],
      },
    });
  });

  it("parses conversational provider responses that omit empty tool arrays", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_followup",
          role: "assistant",
          content: "请确认你想优化第 3 段项目经历吗？",
        },
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: {
        message: {
          id: "msg_assistant_followup",
          role: "assistant",
          content: "请确认你想优化第 3 段项目经历吗？",
        },
        toolCalls: [],
        proposedOperations: [],
      },
    });
  });

  it("converts parsed provider output into chunked AG-UI text events", () => {
    const assistantContent =
      "建议先优化第一段工作经历。我会按 STAR 拆成情境、任务、行动与结果，并标记需要你补充的真实指标。";
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: assistantContent,
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_update_section",
            status: "completed",
            title: "更新经历",
            summary: "改写工作经历。",
            input: { fieldPath: "experience.0.content" },
            result: { operationIds: ["op_1"] },
          },
        ],
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "应用经历改写",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责开发。",
            afterPlainText: "围绕稳定性目标推进前端优化；结果指标需要补充。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "补足任务与行动。",
            riskFlags: [{ type: "needs_user_fact", message: "请补充结果指标。" }],
          },
        ],
      }),
    );
    if (!parsed.ok) throw new Error("expected parse success");

    const events = toAgUiAgentEvents({
      requestId: "req_agent",
      threadId: "resume_abc",
      result: parsed.result,
    });

    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    expect(events[1]?.type).toBe(EventType.TEXT_MESSAGE_START);
    expect(events.at(-2)?.type).toBe(EventType.TEXT_MESSAGE_END);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    const textDeltas = events
      .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => event.delta);
    expect(textDeltas.length).toBeGreaterThan(1);
    expect(textDeltas.join("")).toBe(assistantContent);
    expect(events).toContainEqual(expect.objectContaining({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: "tool_1",
      content: expect.stringContaining('"proposedOperations"'),
    }));
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
