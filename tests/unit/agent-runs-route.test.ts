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
import { POST } from "@/app/api/agent/runs/route";

describe("POST /api/agent/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps AG-UI runs to Agent message streams through the Web BFF", async () => {
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
    (createAgentClient as unknown as Mock).mockReturnValue({
      streamAgentMessage,
    });

    const response = await POST(runRequest(validRunInput()));

    expect(response.status).toBe(200);
    expect(signAgentToken).toHaveBeenCalledWith({
      userId: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
    });
    expect(streamAgentMessage).toHaveBeenCalledWith({
      token: "signed-chat-token",
      request: expect.objectContaining({
        resumeId: "resume_abc",
        workflowId: "resume-diagnose",
      }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-request-id")).toBe("req_agent_stream");
    await expect(response.text()).resolves.toContain("RUN_STARTED");
  });

  it("rejects runs without intro-builder forwarded props", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");

    const response = await POST(runRequest({
      ...validRunInput(),
      forwardedProps: {},
    }));

    expect(response.status).toBe(400);
    expect(signAgentToken).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "forwardedProps.introBuilder is required",
    });
  });

  it("keeps Agent errors typed for SDK callers", async () => {
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
        requestId: "req_timeout",
      }),
    );
    (createAgentClient as unknown as Mock).mockReturnValue({
      streamAgentMessage,
    });

    const response = await POST(runRequest(validRunInput()));

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      error: "Agent 服务暂不可用",
      code: "provider_timeout",
      requestId: "req_timeout",
    });
  });
});

function runRequest(body: unknown): Request {
  return new Request("https://intro.test/api/agent/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

function validRunInput() {
  return {
    threadId: "resume_abc",
    runId: "run_1",
    state: null,
    messages: [
      {
        id: "msg_user_1",
        role: "user",
        content: "请诊断这份简历",
      },
    ],
    tools: [],
    context: [],
    forwardedProps: {
      introBuilder: {
        resumeId: "resume_abc",
        locale: "zh-CN",
        workflowId: "resume-diagnose",
        context: {
          resumeTitle: "前端工程师",
          templateId: "professional",
          activeSection: null,
          completeness: {
            overall: 80,
            sections: [
              { key: "experience", label: "工作经历", score: 18, max: 25 },
            ],
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
      },
    },
  };
}
