import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({ currentUserId: vi.fn() }));
vi.mock("@/lib/agent/token", () => ({ signAgentToken: vi.fn() }));
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
import { POST } from "@/app/api/agent/direct-runs/route";

describe("POST /api/agent/direct-runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "AGENT_PUBLIC_BASE_URL",
      "https://api.rory-x.me/intro-builder/agent",
    );
  });

  it("rejects unauthenticated direct run bootstraps", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue(null);

    const response = await POST(runRequest(validRunInput()));

    expect(response.status).toBe(401);
    expect(signAgentToken).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
  });

  it("returns a direct Agent stream bootstrap after BFF auth and resume ownership checks", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
      id: "resume_abc",
      title: "前端工程师",
    });
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-chat-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });

    const response = await POST(runRequest(validRunInput()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(signAgentToken).toHaveBeenCalledWith({
      userId: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
    });
    expect(body).toEqual({
      status: "ok",
      streamUrl:
        "https://api.rory-x.me/intro-builder/agent/v1/agent/messages",
      token: "signed-chat-token",
      tokenExpiresAt: "2026-06-08T08:02:00.000Z",
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
  });

  it("starts create-from-zero direct runs without requiring a resume row", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-create-zero-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });

    const response = await POST(runRequest(createFromZeroRunInput()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.query.resumes.findFirst).not.toHaveBeenCalled();
    expect(signAgentToken).toHaveBeenCalledWith({
      userId: "user_123",
      scope: "agent:chat",
    });
    expect(body.request).toEqual(
      expect.objectContaining({
        resumeId: null,
        mode: "create_from_zero",
        workflowId: "create-from-zero",
        context: null,
        sessionContext: expect.objectContaining({
          sessionId: expect.stringMatching(
            /^agent_session_create_from_zero_[0-9a-f]{16}_thread_a$/,
          ),
          threadId: "thread_a",
          resumeId: null,
          mode: "create_from_zero",
          workflowId: "create-from-zero",
          resumeTitle: "从 0 创建简历",
        }),
      }),
    );
  });

  it("rejects direct runs for resumes the current user does not own", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue(null);

    const response = await POST(runRequest(validRunInput()));

    expect(response.status).toBe(404);
    expect(signAgentToken).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "简历不存在" });
  });
});

function runRequest(body: unknown): Request {
  return new Request("https://intro.test/api/agent/direct-runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
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
    threadId: "thread_a",
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
