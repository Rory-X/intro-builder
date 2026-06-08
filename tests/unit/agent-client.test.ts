// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { AgentClientError, createAgentClient } from "@/lib/agent/client";

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
    const fetchMock = vi.fn(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({
          status: "ok",
          requestId: "req_agent_polish",
          result: {
            format: "plain_text",
            polishedText: "负责业务系统前端开发，围绕页面性能瓶颈持续优化加载与交互体验。",
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
