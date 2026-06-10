import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import {
  buildAgentMessagePrompt,
  createOpenAICompatibleAgentMessageProvider,
  extractStreamingAgentMessageContent,
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

  it("normalizes provider operations that omit transport toolCallId linkage", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_tool_fix",
          role: "assistant",
          content: "我生成了 1 条待确认修改。",
        },
        toolCalls: [],
        proposedOperations: [
          {
            id: "op_1",
            label: "应用经历改写",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "Token 调用优化降低 200%。",
            afterPlainText: "Token 调用优化提升 200% 效率。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "修正指标表述，保留用户确认写回。",
            riskFlags: [],
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: {
        message: {
          id: "msg_assistant_tool_fix",
          role: "assistant",
          content: "我生成了 1 条待确认修改。",
        },
        toolCalls: [
          expect.objectContaining({
            id: "tool_op_1",
            name: "resume_update_section",
            status: "completed",
          }),
        ],
        proposedOperations: [
          expect.objectContaining({
            id: "op_1",
            toolCallId: "tool_op_1",
            operation: "update_section",
          }),
        ],
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

  it("extracts partial assistant content from streaming provider JSON", () => {
    const partialJson =
      '{"message":{"id":"msg_assistant_1","role":"assistant","content":"先优化第一段经历\\n补充真实结果';

    expect(extractStreamingAgentMessageContent(partialJson)).toBe(
      "先优化第一段经历\n补充真实结果",
    );
    expect(extractStreamingAgentMessageContent('{"message":{"content":"')).toBe("");
    expect(extractStreamingAgentMessageContent('{"toolCalls":[{"input":{"content":"不要吐工具参数"}}]}')).toBe("");
  });

  it("streams raw provider JSON deltas from OpenAI-compatible chat completions", async () => {
    const providerJson = JSON.stringify({
      message: {
        id: "msg_assistant_1",
        role: "assistant",
        content: "像 ChatGPT 一样逐字输出。",
      },
      toolCalls: [],
      proposedOperations: [],
    });
    const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body));
      expect(requestBody.stream).toBe(true);
      return new Response(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: providerJson.slice(0, 24) } }] })}\n\n`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: providerJson.slice(24) } }] })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );
    };
    const provider = createOpenAICompatibleAgentMessageProvider(
      agentConfig(),
      fetchMock as unknown as typeof fetch,
    );
    if (!provider?.stream) throw new Error("expected streaming provider");

    const chunks = [];
    for await (const chunk of provider.stream({
      request: validBody(),
      prompt: buildAgentMessagePrompt(validBody()),
      session: {
        userId: "user_123",
        resumeId: "resume_abc",
        scope: "agent:chat",
        jti: "jti_stream",
        expiresAt: new Date("2026-06-08T08:02:00.000Z"),
      },
      requestId: "req_stream",
    })) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === "content_delta").map((chunk) => chunk.delta).join("")).toBe(providerJson);
    expect(chunks.at(-1)).toMatchObject({
      type: "usage",
      usage: {
        provider: "openai-compatible",
        model: "deepseek-chat",
      },
    });
  });

  it("outputs RUN_FINISHED with interrupt when proposedOperations are present", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "我建议优化这段经历。",
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_update_section",
            status: "completed",
            title: "更新经历",
            summary: "改写工作经历",
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
            afterPlainText: "围绕稳定性目标推进前端优化。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "补足任务与行动。",
            riskFlags: [],
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

    const runFinished = events.find((event) => event.type === EventType.RUN_FINISHED);
    expect(runFinished).toMatchObject({
      type: EventType.RUN_FINISHED,
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "op_1",
            reason: "approval_required",
            message: "应用经历改写: 补足任务与行动。",
            toolCallId: "tool_1",
            metadata: { operation: parsed.result.proposedOperations[0] },
          },
        ],
      },
    });
  });

  it("outputs RUN_FINISHED with success when no proposedOperations", () => {
    const parsed = parseAgentMessageProviderResponse(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "你的简历已经很好了。",
        },
        toolCalls: [],
        proposedOperations: [],
      }),
    );
    if (!parsed.ok) throw new Error("expected parse success");

    const events = toAgUiAgentEvents({
      requestId: "req_agent",
      threadId: "resume_abc",
      result: parsed.result,
    });

    const runFinished = events.find((event) => event.type === EventType.RUN_FINISHED);
    expect(runFinished).toMatchObject({
      type: EventType.RUN_FINISHED,
      outcome: { type: "success" },
    });
  });
});

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN" as const,
    workflowId: "resume-diagnose" as const,
    messages: [{ id: "msg_user_1", role: "user" as const, content: "诊断整份简历" }],
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

function agentConfig() {
  return {
    host: "127.0.0.1",
    port: 0,
    serviceName: "intro-agent-test",
    version: "test-version",
    nodeEnv: "test",
    shutdownTimeoutMs: 100,
    redisUrl: "redis://127.0.0.1:6379",
    redisConnectTimeoutMs: 100,
    rateLimitWindowSeconds: 60,
    rateLimitMaxRequests: 30,
    jwtIssuer: "intro-builder-web",
    jwtAudience: "intro-builder-agent",
    jwtSecret: "test-agent-secret",
    jwtReplayTtlSeconds: 180,
    modelBaseUrl: "https://provider.test/v1",
    modelApiKey: "provider-key",
    modelName: "deepseek-chat",
    modelTimeoutMs: 20_000,
  };
}
