import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({ currentUserId: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ createProviderStreamer: vi.fn() }));
vi.mock("@/lib/ai/resume-source", () => ({ loadResumeSourceForRun: vi.fn() }));
vi.mock("@/lib/ai/run-store", () => ({ startRun: vi.fn(), acquireLease: vi.fn() }));
vi.mock("@/lib/ai/run-route-support", () => ({ streamRunAttempt: vi.fn() }));

import { currentUserId } from "@/lib/auth-helpers";
import { createProviderStreamer } from "@/lib/ai/provider";
import { loadResumeSourceForRun } from "@/lib/ai/resume-source";
import { acquireLease, startRun } from "@/lib/ai/run-store";
import { streamRunAttempt } from "@/lib/ai/run-route-support";
import { POST } from "@/app/api/agent/direct-runs/route";

describe("POST /api/agent/direct-runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createProviderStreamer as unknown as Mock).mockReturnValue({
      ok: true,
      streamModel: vi.fn(),
    });
  });

  it("未登录时不创建 Run", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue(null);

    const response = await POST(runRequest(validRunInput()));

    expect(response.status).toBe(401);
    expect(startRun).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
  });

  it("没有模型配置时拒绝，不创建 Run", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");

    const response = await POST(runRequest(validRunInput()));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "missing_model_config" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("从 0 创建但没有简历时拒绝", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");

    const response = await POST(runRequest(createFromZeroRunInput()));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "resume_required" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("简历不属于当前用户时返回 404", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (loadResumeSourceForRun as unknown as Mock).mockResolvedValue(null);

    const response = await POST(runRequest(withModel(validRunInput())));

    expect(response.status).toBe(404);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("在 Next.js Run 上执行，并把事件翻译成 AG-UI 流", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (createProviderStreamer as unknown as Mock).mockReturnValue({
      ok: true,
      streamModel: vi.fn(),
    });
    (loadResumeSourceForRun as unknown as Mock).mockResolvedValue({
      revision: 3,
      content: { sectionOrder: [] },
      title: "前端工程师",
      templateId: "professional",
    });
    (startRun as unknown as Mock).mockResolvedValue({ status: "created", runId: "db-run" });
    (acquireLease as unknown as Mock).mockResolvedValue({
      status: "acquired",
      fenceToken: 7,
      leaseExpiresAt: new Date("2026-09-28T00:00:00.000Z"),
    });
    (streamRunAttempt as unknown as Mock).mockReturnValue(
      new Response(
        `data: ${JSON.stringify({
          schemaVersion: 1,
          eventId: "e1",
          runId: "db-run",
          attemptId: "a1",
          sequence: 1,
          type: "text.delta",
          occurredAt: "2026-09-28T00:00:00.000Z",
          payload: { text: "已检查" },
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
    );

    const response = await POST(runRequest(withModel(validRunInput())));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain('"type":"RUN_STARTED"');
    expect(body).toContain('"delta":"已检查"');
    expect(body).not.toContain("streamUrl");
    expect(body).not.toContain("api.rory-x.me");
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeId: "resume_abc",
        userId: "user_123",
        writeMode: "direct",
        requestId: "run_1",
      }),
    );
    expect(streamRunAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeId: "resume_abc",
        message: "请诊断这份简历",
        writeMode: "direct",
        fenceToken: 7,
      }),
    );
  });
});

function withModel(input: ReturnType<typeof validRunInput>) {
  return {
    ...input,
    forwardedProps: {
      introBuilder: {
        ...input.forwardedProps.introBuilder,
        modelConfig: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
          modelName: "m",
        },
      },
    },
  };
}

function runRequest(body: unknown): Request {
  return new Request("https://intro.test/api/agent/direct-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
