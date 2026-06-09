import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({ currentUserId: vi.fn() }));
vi.mock("@/lib/agent/token", () => ({ signAgentToken: vi.fn() }));
vi.mock("@/lib/agent/client", () => ({
  AgentClientError: class AgentClientError extends Error {
    statusCode: number;
    error: string;
    requestId: string;
    retryAfterSeconds?: number;

    constructor(
      message: string,
      options: {
        statusCode: number;
        error: string;
        requestId: string;
        retryAfterSeconds?: number;
      },
    ) {
      super(message);
      this.name = "AgentClientError";
      this.statusCode = options.statusCode;
      this.error = options.error;
      this.requestId = options.requestId;
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  },
  createAgentClient: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: {
    query: {
      resumes: {
        findFirst: vi.fn(),
      },
    },
  },
}));

import { db } from "@/db";
import { currentUserId } from "@/lib/auth-helpers";
import { AgentClientError, createAgentClient } from "@/lib/agent/client";
import { signAgentToken } from "@/lib/agent/token";
import { POST } from "@/app/api/agent/messages/route";

describe("POST /api/agent/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a Web user session", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue(null);

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
  });

  it("requires the resume to belong to the Web user", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue(null);

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "简历不存在" });
  });

  it("signs an agent:chat token and proxies the request to Agent", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      id: "resume_abc",
    });
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-chat-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    const sendAgentMessage = vi.fn().mockResolvedValue({
      requestId: "req_agent_message",
      data: {
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
        cached: true,
        cachedAt: "2026-06-09T00:00:00.000Z",
      },
    });
    (createAgentClient as unknown as Mock).mockReturnValue({ sendAgentMessage });
    const body = validBody();

    const response = await POST(jsonRequest(body));

    expect(response.status).toBe(200);
    expect(signAgentToken).toHaveBeenCalledWith({
      userId: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
    });
    expect(sendAgentMessage).toHaveBeenCalledWith({
      token: "signed-chat-token",
      request: body,
    });
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      tokenExpiresAt: "2026-06-08T08:02:00.000Z",
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
      cached: true,
      cachedAt: "2026-06-09T00:00:00.000Z",
    });
  });

  it("proxies AG-UI SSE streams when the browser requests text/event-stream", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      id: "resume_abc",
    });
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-chat-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"type":"RUN_STARTED"}\n\n'),
        );
        controller.close();
      },
    });
    const streamAgentMessage = vi.fn().mockResolvedValue({
      requestId: "req_agent_stream",
      data: {
        body: stream,
        contentType: "text/event-stream",
      },
    });
    const sendAgentMessage = vi.fn();
    (createAgentClient as unknown as Mock).mockReturnValue({
      sendAgentMessage,
      streamAgentMessage,
    });
    const body = validBody();

    const response = await POST(sseRequest(body));

    expect(response.status).toBe(200);
    expect(signAgentToken).toHaveBeenCalledWith({
      userId: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
    });
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(streamAgentMessage).toHaveBeenCalledWith({
      token: "signed-chat-token",
      request: body,
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-request-id")).toBe("req_agent_stream");
    await expect(response.text()).resolves.toContain("RUN_STARTED");
  });

  it("returns Agent errors without exposing provider internals", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      id: "resume_abc",
    });
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-chat-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    const sendAgentMessage = vi.fn().mockRejectedValue(
      new AgentClientError("Too many requests", {
        statusCode: 429,
        error: "rate_limited",
        requestId: "req_limited",
        retryAfterSeconds: 30,
      }),
    );
    (createAgentClient as unknown as Mock).mockReturnValue({ sendAgentMessage });

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Agent 服务暂不可用",
      code: "rate_limited",
      requestId: "req_limited",
      retryAfterSeconds: 30,
    });
  });

  it("returns Agent SSE errors with code and request id", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      id: "resume_abc",
    });
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-chat-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    const streamAgentMessage = vi.fn().mockRejectedValue(
      new AgentClientError("Provider timed out", {
        statusCode: 504,
        error: "provider_timeout",
        requestId: "req_sse_timeout",
      }),
    );
    const sendAgentMessage = vi.fn();
    (createAgentClient as unknown as Mock).mockReturnValue({
      sendAgentMessage,
      streamAgentMessage,
    });

    const response = await POST(sseRequest(validBody()));

    expect(response.status).toBe(504);
    expect(sendAgentMessage).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Agent 服务暂不可用",
      code: "provider_timeout",
      requestId: "req_sse_timeout",
    });
  });
});

function validBody() {
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

function jsonRequest(body: unknown): Request {
  return new Request("https://intro.test/api/agent/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sseRequest(body: unknown): Request {
  return new Request("https://intro.test/api/agent/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
}
