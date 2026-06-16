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
import { maxDuration, POST, runtime } from "@/app/api/agent/runs/route";

describe("POST /api/agent/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the Node runtime with an explicit long streaming duration", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(120);
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
        sessionContext: {
          sessionId: "agent_session_resume_abc",
          threadId: "resume_abc",
          resumeId: "resume_abc",
          mode: "optimize_existing",
          workflowId: "resume-diagnose",
          resumeTitle: "前端工程师",
        },
      }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-request-id")).toBe("req_agent_stream");
    await expect(response.text()).resolves.toContain("RUN_STARTED");
  });

  it("streams through the fallback BFF route without Web-side tee persistence", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      id: "resume_abc",
      title: "前端工程师",
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
        controller.enqueue(
          new TextEncoder().encode('data: {"type":"RUN_FINISHED"}\n\n'),
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
    await expect(response.text()).resolves.toContain("RUN_FINISHED");
    expect(streamAgentMessage).toHaveBeenCalledWith({
      token: "signed-chat-token",
      request: expect.objectContaining({
        resumeId: "resume_abc",
        sessionContext: expect.objectContaining({
          sessionId: "agent_session_resume_abc",
          resumeTitle: "前端工程师",
        }),
      }),
    });
  });

  it("starts create-from-zero runs without requiring an existing resume row", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-create-zero-token",
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
      requestId: "req_agent_create_zero",
      data: {
        body: stream,
        contentType: "text/event-stream",
      },
    });
    (createAgentClient as unknown as Mock).mockReturnValue({
      streamAgentMessage,
    });

    const response = await POST(runRequest(createFromZeroRunInput()));

    expect(response.status).toBe(200);
    expect(db.query.resumes.findFirst).not.toHaveBeenCalled();
    expect(signAgentToken).toHaveBeenCalledWith({
      userId: "user_123",
      scope: "agent:chat",
    });
    expect(streamAgentMessage).toHaveBeenCalledWith({
      token: "signed-create-zero-token",
      request: expect.objectContaining({
        resumeId: null,
        mode: "create_from_zero",
        workflowId: "create-from-zero",
        context: null,
        sessionContext: expect.objectContaining({
          sessionId: expect.stringMatching(/^agent_session_create_from_zero_/),
          threadId: "agent_create_from_zero",
          resumeId: null,
          mode: "create_from_zero",
          workflowId: "create-from-zero",
          resumeTitle: "从 0 创建简历",
        }),
      }),
    });
    await expect(response.text()).resolves.toContain("RUN_STARTED");
  });

  it("uses separate create-from-zero sessions for each user and AG-UI thread", async () => {
    const first = await postCreateFromZeroRun({
      userId: "user_123",
      threadId: "thread_a",
      requestId: "req_create_a",
    });
    const second = await postCreateFromZeroRun({
      userId: "user_123",
      threadId: "thread_b",
      requestId: "req_create_b",
    });
    const third = await postCreateFromZeroRun({
      userId: "user_456",
      threadId: "thread_a",
      requestId: "req_create_c",
    });

    expect(first.sessionId).toMatch(/^agent_session_create_from_zero_/);
    expect(first.sessionId).not.toContain("user_123");
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(third.sessionId).not.toBe(first.sessionId);
    expect(first.threadId).toBe("thread_a");
    expect(second.threadId).toBe("thread_b");
    expect(third.threadId).toBe("thread_a");
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

function createFromZeroRunInput() {
  return {
    ...validRunInput(),
    threadId: "agent_create_from_zero",
    messages: [
      {
        id: "msg_user_create",
        role: "user",
        content: "从 0 帮我做一份简历",
      },
    ],
    forwardedProps: {
      introBuilder: {
        resumeId: null,
        mode: "create_from_zero",
        locale: "zh-CN",
        workflowId: "create-from-zero",
        context: null,
      },
    },
  };
}

async function postCreateFromZeroRun({
  userId,
  threadId,
  requestId,
}: {
  userId: string;
  threadId: string;
  requestId: string;
}) {
  (currentUserId as unknown as Mock).mockResolvedValue(userId);
  (signAgentToken as unknown as Mock).mockResolvedValue({
    token: `signed-create-zero-token-${requestId}`,
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
    requestId,
    data: {
      body: stream,
      contentType: "text/event-stream",
    },
  });
  (createAgentClient as unknown as Mock).mockReturnValue({
    streamAgentMessage,
  });

  const response = await POST(runRequest({
    ...createFromZeroRunInput(),
    threadId,
  }));

  expect(response.status).toBe(200);
  await expect(response.text()).resolves.toContain("RUN_STARTED");
  const latestStreamAgentMessage = (createAgentClient as unknown as Mock).mock.results.at(-1)
    ?.value.streamAgentMessage as Mock;
  return latestStreamAgentMessage.mock.calls.at(-1)?.[0]?.request.sessionContext as {
    sessionId: string;
    threadId: string;
  };
}
