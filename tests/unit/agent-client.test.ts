// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  AgentClientError,
  createAgentClient,
  type RichTextPolishResponse,
} from "@/lib/agent/client";

describe("Web Agent client", () => {
  it("calls the protected Agent session endpoint with bearer token and request id", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          status: "ok",
          subject: "user_123",
          resumeId: "resume_abc",
          scope: "agent:session",
          expiresAt: "2026-06-08T08:02:00.000Z",
          requestId: "req_agent",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_agent",
          },
        },
      );
    });
    const client = createAgentClient({
      baseUrl: "https://agent.test/intro-builder/agent",
      fetchFn: fetchMock as unknown as typeof fetch,
      createRequestId: () => "req_web",
    });

    const result = await client.getSession({ token: "jwt-token" });

    expect(result).toEqual({
      data: {
        status: "ok",
        subject: "user_123",
        resumeId: "resume_abc",
        scope: "agent:session",
        expiresAt: "2026-06-08T08:02:00.000Z",
        requestId: "req_agent",
      },
      requestId: "req_agent",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent.test/intro-builder/agent/v1/session",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer jwt-token",
          "X-Request-Id": "req_web",
        },
      }),
    );
  });

  it("maps Agent error envelopes into typed client errors", async () => {
    const client = createAgentClient({
      baseUrl: "https://agent.test",
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            error: "rate_limited",
            message: "Too many requests",
            requestId: "req_limited",
            retryAfterSeconds: 30,
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "x-request-id": "req_limited",
            },
          },
        ),
    });

    await expect(client.getSession({ token: "jwt-token" })).rejects.toEqual(
      new AgentClientError("Too many requests", {
        statusCode: 429,
        error: "rate_limited",
        requestId: "req_limited",
        retryAfterSeconds: 30,
      }),
    );
  });

  it("posts rich text polish requests with bearer token and request id", async () => {
    const replacementTiptapJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "负责业务系统前端开发，围绕页面性能瓶颈持续优化加载与交互体验。",
            },
          ],
        },
      ],
    };
    const fetchMock = vi.fn(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          status: "ok",
          requestId: "req_agent_polish",
          result: {
            format: "tiptap_json",
            polishedText: "负责业务系统前端开发，围绕页面性能瓶颈持续优化加载与交互体验。",
            replacementTiptapJson,
            changeSummary: "按 STAR 思路强化职责与行动表达，未新增结果数据。",
            riskFlags: [
              {
                type: "too_little_context",
                message: "原文缺少可量化结果，已按现有信息保守润色。",
              },
            ],
          },
          usage: {
            provider: "fake-provider",
            model: "fake-model",
            inputTokens: 120,
            outputTokens: 36,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_agent_polish",
          },
        },
      );
    });
    const client = createAgentClient({
      baseUrl: "https://agent.test/intro-builder/agent",
      fetchFn: fetchMock as unknown as typeof fetch,
      createRequestId: () => "req_web_polish",
    });
    const request = {
      resumeId: "resume_abc",
      section: "experience" as const,
      fieldPath: "experience.0.content",
      locale: "zh-CN" as const,
      content: {
        format: "tiptap_json" as const,
        plainText: "负责业务系统前端开发，优化页面性能。",
        tiptapJson: { type: "doc", content: [] },
      },
      intent: {
        mode: "polish" as const,
        tone: "professional" as const,
        length: "same" as const,
        strategy: "star" as const,
      },
    };

    const result = await client.polishRichText({
      token: "jwt-token",
      request,
    });

    expect(result.requestId).toBe("req_agent_polish");
    expect(result.data.result.polishedText).toContain("性能瓶颈");
    if (result.data.result.format !== "tiptap_json") {
      throw new Error("Expected TipTap polish result");
    }
    const tiptapResult: Extract<
      RichTextPolishResponse["result"],
      { format: "tiptap_json" }
    > = result.data.result;
    expect(tiptapResult.replacementTiptapJson).toEqual(replacementTiptapJson);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent.test/intro-builder/agent/v1/rich-text/polish",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer jwt-token",
          "X-Request-Id": "req_web_polish",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      }),
    );
  });

  it("posts resume helper requests with bearer token and request id", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          status: "ok",
          requestId: "req_agent_helper",
          helperId: "resume-diagnose",
          result: {
            summary: "整体内容完整，但工作经历缺少可验证结果。",
            suggestions: [],
          },
          usage: {
            provider: "fake-provider",
            model: "fake-model",
            inputTokens: 620,
            outputTokens: 180,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_agent_helper",
          },
        },
      );
    });
    const client = createAgentClient({
      baseUrl: "https://agent.test/intro-builder/agent",
      fetchFn: fetchMock as unknown as typeof fetch,
      createRequestId: () => "req_web_helper",
    });
    const request = {
      resumeId: "resume_abc",
      locale: "zh-CN" as const,
      target: { kind: "resume" as const, section: null, fieldPath: null },
      context: {
        resumeTitle: "前端开发工程师",
        completeness: {
          overall: 68,
          sections: [{ key: "experience", label: "工作经历", score: 7, max: 10 }],
        },
        sections: [
          {
            key: "experience",
            label: "工作经历",
            plainText: "负责业务系统前端开发，优化页面性能。",
          },
        ],
      },
      intent: { mode: "diagnose" as const, maxSuggestions: 5, strategy: "star" as const },
    };

    const result = await client.runResumeHelper({
      token: "jwt-token",
      helperId: "resume-diagnose",
      request,
    });

    expect(result.requestId).toBe("req_agent_helper");
    expect(result.data.result.summary).toContain("工作经历");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent.test/intro-builder/agent/v1/resume/helpers/resume-diagnose",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer jwt-token",
          "X-Request-Id": "req_web_helper",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      }),
    );
  });

  it("posts Agent messages with bearer token and request id", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          status: "ok",
          requestId: "req_agent_message",
          message: {
            id: "msg_assistant_1",
            role: "assistant",
            content: "建议先优化第一段工作经历。",
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
          usage: {
            provider: "fake-provider",
            model: "fake-model",
            inputTokens: 900,
            outputTokens: 240,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_agent_message",
          },
        },
      );
    });
    const client = createAgentClient({
      baseUrl: "https://agent.test/intro-builder/agent",
      fetchFn: fetchMock as unknown as typeof fetch,
      createRequestId: () => "req_web_message",
    });
    const request = validAgentMessageRequest();

    const result = await client.sendAgentMessage({
      token: "jwt-token",
      request,
    });

    expect(result.requestId).toBe("req_agent_message");
    expect(result.data.message.content).toContain("优化第一段工作经历");
    expect(result.data.toolCalls[0]?.name).toBe("resume_read");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent.test/intro-builder/agent/v1/agent/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer jwt-token",
          "X-Request-Id": "req_web_message",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      }),
    );
  });

  it("streams Agent messages with AG-UI SSE accept header", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"RUN_STARTED"}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async (): Promise<Response> => {
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req_agent_stream",
        },
      });
    });
    const client = createAgentClient({
      baseUrl: "https://agent.test/intro-builder/agent",
      fetchFn: fetchMock as unknown as typeof fetch,
      createRequestId: () => "req_web_stream",
    });
    const request = validAgentMessageRequest();

    const result = await client.streamAgentMessage({
      token: "jwt-token",
      request,
    });

    expect(result.requestId).toBe("req_agent_stream");
    expect(result.data.contentType).toBe("text/event-stream");
    await expect(new Response(result.data.body).text()).resolves.toContain(
      "RUN_STARTED",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent.test/intro-builder/agent/v1/agent/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer jwt-token",
          "X-Request-Id": "req_web_stream",
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(request),
      }),
    );
  });

  it("aborts requests after the configured timeout", async () => {
    vi.useFakeTimers();
    const client = createAgentClient({
      baseUrl: "https://agent.test",
      timeoutMs: 10,
      fetchFn: async (...args) =>
        new Promise<Response>((_resolve, reject) => {
          const init = args[1];
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });

    const pending = client.getSession({ token: "jwt-token" });
    const expectation = expect(pending).rejects.toMatchObject(
      new AgentClientError("Agent request timed out", {
        statusCode: 504,
        error: "agent_timeout",
        requestId: expect.any(String),
      }),
    );

    await vi.advanceTimersByTimeAsync(11);
    await expectation;
    vi.useRealTimers();
  });
});

function validAgentMessageRequest() {
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
  };
}
