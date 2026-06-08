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

import { currentUserId } from "@/lib/auth-helpers";
import { signAgentToken } from "@/lib/agent/token";
import { AgentClientError, createAgentClient } from "@/lib/agent/client";
import { db } from "@/db";
import { POST } from "@/app/api/agent/rich-text/polish/route";

describe("POST /api/agent/rich-text/polish", () => {
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

  it("signs a rich_text:polish token and proxies the request to Agent", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      id: "resume_abc",
    });
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-polish-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    const polishRichText = vi.fn().mockResolvedValue({
      requestId: "req_agent_polish",
      data: {
        status: "ok",
        requestId: "req_agent_polish",
        result: {
          format: "plain_text",
          polishedText: "负责业务系统前端开发，围绕页面性能瓶颈持续优化加载与交互体验。",
          changeSummary: "按 STAR 思路强化职责与行动表达，未新增结果数据。",
          riskFlags: [],
        },
        usage: {
          provider: "fake-provider",
          model: "fake-model",
          inputTokens: 120,
          outputTokens: 36,
        },
      },
    });
    (createAgentClient as unknown as Mock).mockReturnValue({ polishRichText });
    const body = validBody();

    const response = await POST(jsonRequest(body));

    expect(response.status).toBe(200);
    expect(signAgentToken).toHaveBeenCalledWith({
      userId: "user_123",
      resumeId: "resume_abc",
      scope: "rich_text:polish",
    });
    expect(polishRichText).toHaveBeenCalledWith({
      token: "signed-polish-token",
      request: body,
    });
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      tokenExpiresAt: "2026-06-08T08:02:00.000Z",
      requestId: "req_agent_polish",
      result: {
        format: "plain_text",
        polishedText: "负责业务系统前端开发，围绕页面性能瓶颈持续优化加载与交互体验。",
        changeSummary: "按 STAR 思路强化职责与行动表达，未新增结果数据。",
        riskFlags: [],
      },
      usage: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 120,
        outputTokens: 36,
      },
    });
  });

  it("returns Agent error envelopes without exposing provider internals", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      id: "resume_abc",
    });
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-polish-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    const polishRichText = vi.fn().mockRejectedValue(
      new AgentClientError("Too many requests", {
        statusCode: 429,
        error: "rate_limited",
        requestId: "req_limited",
        retryAfterSeconds: 30,
      }),
    );
    (createAgentClient as unknown as Mock).mockReturnValue({ polishRichText });

    const response = await POST(jsonRequest(validBody()));

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
}

function jsonRequest(body: unknown): Request {
  return new Request("https://intro.test/api/agent/rich-text/polish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
