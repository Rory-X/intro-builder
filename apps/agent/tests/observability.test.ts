import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedAgentSession } from "../src/auth";
import { loadConfig } from "../src/config";
import type { AgentMessageRequest } from "../src/agent-messages";
import {
  buildAgentMessageTraceMetadata,
  createAgentObservability,
} from "../src/observability";

describe("agent observability", () => {
  it("is no-op when Langfuse is not configured", async () => {
    const observability = createAgentObservability(loadConfig({}));
    const onRun = vi.fn(async () => "ok");

    const result = await observability.traceAgentMessageRun(
      {
        request: sampleRequest(),
        session: sampleSession(),
        requestId: "req_test",
        cacheStatus: "miss",
      },
      onRun,
    );

    expect(result).toBe("ok");
    expect(onRun).toHaveBeenCalledTimes(1);
    await expect(observability.flush()).resolves.toBeUndefined();
    await expect(observability.shutdown()).resolves.toBeUndefined();
  });

  it("builds privacy-safe trace metadata by default", () => {
    const metadata = buildAgentMessageTraceMetadata({
      config: loadConfig({
        AGENT_MODEL_NAME: "gpt-test",
      }),
      request: sampleRequest(),
      session: sampleSession(),
      requestId: "req_test",
      cacheStatus: "miss",
    });

    expect(metadata).toMatchObject({
      requestId: "req_test",
      workflowId: "experience-star",
      serviceName: "intro-agent",
      serviceVersion: "0.0.0-dev",
      environment: "development",
      modelName: "gpt-test",
      resumeId: "resume_123",
      messageCount: 1,
      sectionCount: 1,
      cacheStatus: "miss",
      captureRawPayloads: false,
    });
    expect(metadata.userHash).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata).not.toHaveProperty("userId");
    expect(JSON.stringify(metadata)).not.toContain("负责前端开发");
    expect(JSON.stringify(metadata)).not.toContain("请优化我的经历");
  });

  it("includes raw payload summaries only when explicitly enabled", () => {
    const metadata = buildAgentMessageTraceMetadata({
      config: loadConfig({
        LANGFUSE_CAPTURE_RAW_PAYLOADS: "true",
      }),
      request: sampleRequest(),
      session: sampleSession(),
      requestId: "req_test",
      cacheStatus: "hit",
    });

    expect(metadata.captureRawPayloads).toBe(true);
    expect(metadata.raw).toEqual({
      messages: [{ role: "user", content: "请优化我的经历" }],
      sections: [
        {
          key: "experience",
          label: "工作经历",
          fieldPath: "experience.0.content",
          plainText: "负责前端开发。",
        },
      ],
    });
  });
});

function sampleSession(): AuthenticatedAgentSession {
  return {
    userId: "user_secret",
    resumeId: "resume_123",
    scope: "agent:chat",
    jti: "jti_test",
    expiresAt: new Date("2026-06-10T00:00:00.000Z"),
  };
}

function sampleRequest(): AgentMessageRequest {
  return {
    resumeId: "resume_123",
    locale: "zh-CN",
    workflowId: "experience-star",
    messages: [
      {
        id: "msg_user",
        role: "user",
        content: "请优化我的经历",
      },
    ],
    context: {
      resumeTitle: "前端工程师",
      templateId: "professional",
      activeSection: "experience",
      completeness: {
        overall: 70,
        sections: [{ key: "experience", label: "工作经历", score: 8, max: 10 }],
      },
      sections: [
        {
          key: "experience",
          label: "工作经历",
          fieldPath: "experience.0.content",
          plainText: "负责前端开发。",
        },
      ],
    },
  };
}
