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
import { signAgentToken } from "@/lib/agent/token";
import { AgentClientError, createAgentClient } from "@/lib/agent/client";
import { POST } from "@/app/api/agent/resume/helpers/[helperId]/route";

describe("POST /api/agent/resume/helpers/[helperId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a Web user session", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue(null);

    const response = await POST(jsonRequest(validBody()), routeContext("resume-diagnose"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
  });

  it("requires the resume to belong to the Web user", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue(null);

    const response = await POST(jsonRequest(validBody()), routeContext("resume-diagnose"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "简历不存在" });
  });

  it("signs a resume:helper token and proxies the request to Agent", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      id: "resume_abc",
    });
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-helper-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    const runResumeHelper = vi.fn().mockResolvedValue({
      requestId: "req_agent_helper",
      data: {
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
      },
    });
    (createAgentClient as unknown as Mock).mockReturnValue({ runResumeHelper });

    const response = await POST(jsonRequest(validBody()), routeContext("resume-diagnose"));

    expect(response.status).toBe(200);
    expect(signAgentToken).toHaveBeenCalledWith({
      userId: "user_123",
      resumeId: "resume_abc",
      scope: "resume:helper",
    });
    expect(runResumeHelper).toHaveBeenCalledWith({
      token: "signed-helper-token",
      helperId: "resume-diagnose",
      request: validBody(),
    });
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      tokenExpiresAt: "2026-06-08T08:02:00.000Z",
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
    });
  });

  it("returns Agent errors without exposing provider internals", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      id: "resume_abc",
    });
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-helper-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    const runResumeHelper = vi.fn().mockRejectedValue(
      new AgentClientError("Too many requests", {
        statusCode: 429,
        error: "rate_limited",
        requestId: "req_limited",
        retryAfterSeconds: 30,
      }),
    );
    (createAgentClient as unknown as Mock).mockReturnValue({ runResumeHelper });

    const response = await POST(jsonRequest(validBody()), routeContext("resume-diagnose"));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Agent 服务暂不可用",
      code: "rate_limited",
      requestId: "req_limited",
      retryAfterSeconds: 30,
    });
  });
});

function validBody() {
  return {
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
}

function jsonRequest(body: unknown): Request {
  return new Request("https://intro.test/api/agent/resume/helpers/resume-diagnose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(helperId: string) {
  return {
    params: Promise.resolve({ helperId }),
  };
}
