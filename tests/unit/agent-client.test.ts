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
