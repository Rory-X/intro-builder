import { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { EventType, BaseEventSchema, type BaseEvent } from "@ag-ui/core";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentReplayStore } from "../src/auth";
import type { AgentMessageProvider } from "../src/agent-messages";
import type { AiCacheEntry, AiCacheStore } from "../src/ai-cache";
import { createAgentServer } from "../src/http";
import type {
  AgentCacheStatus,
  AgentMessageGenerationTraceInput,
  AgentMessageParseTrace,
  AgentMessageTrace,
  AgentMessageTraceContext,
  AgentObservability,
} from "../src/observability";
import type { RichTextPolishProvider } from "../src/rich-text-polish";
import type { ResumeHelperProvider } from "../src/resume-helpers";

type TestAgentServer = Server & {
  url: (path: string) => string;
};

const servers: TestAgentServer[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server: TestAgentServer) =>
        new Promise<void>((resolve, reject) => {
          server.close((error?: Error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    ),
  );
});

describe("agent HTTP service", () => {
  it("returns service metadata from /health", async () => {
    const server = await listenOnRandomPort();
    const response = await fetch(server.url("/health"), {
      headers: { "x-request-id": "req-client-health" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBe("req-client-health");
    expect(body).toMatchObject({
      status: "ok",
      service: "intro-agent-test",
      version: "test-version",
      uptimeSeconds: 42,
    });
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns readiness metadata from /ready", async () => {
    const server = await listenOnRandomPort();
    const response = await fetch(server.url("/ready"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      service: "intro-agent-test",
      version: "test-version",
      dependencies: {
        redis: "ready",
      },
    });
  });

  it("returns dependency_unavailable when Redis readiness fails", async () => {
    const server = await listenOnRandomPort({
      redisReady: async () => ({
        ok: false,
        message: "Redis ping failed",
      }),
    });
    const response = await fetch(server.url("/ready"), {
      headers: { "x-request-id": "req-client-ready" },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("req-client-ready");
    await expect(response.json()).resolves.toEqual({
      error: "dependency_unavailable",
      message: "Redis ping failed",
      requestId: "req-client-ready",
      dependency: "redis",
    });
  });

  it("returns JSON 404 responses for unknown paths", async () => {
    const server = await listenOnRandomPort();
    const response = await fetch(server.url("/missing"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "not_found",
      message: "Route not found",
      requestId: "req_test_1",
    });
  });

  it("returns JSON 405 responses for unsupported health methods", async () => {
    const server = await listenOnRandomPort();
    const response = await fetch(server.url("/health"), { method: "POST" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "Method not allowed",
      requestId: "req_test_1",
    });
  });

  it("returns the authenticated Agent session from /v1/session", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:session",
      jti: "jti_http_valid",
    });
    const response = await fetch(server.url("/v1/session"), {
      headers: {
        authorization: `Bearer ${token}`,
        "x-request-id": "req-client-session",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-client-session");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      subject: "user_123",
      resumeId: "resume_abc",
      scope: "agent:session",
      expiresAt: "2026-06-08T08:02:00.000Z",
      requestId: "req-client-session",
    });
  });

  it("returns JSON 401 responses for missing Agent session tokens", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
    });
    const response = await fetch(server.url("/v1/session"), {
      headers: { "x-request-id": "req-client-missing-token" },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe(
      "req-client-missing-token",
    );
    await expect(response.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Missing bearer token",
      requestId: "req-client-missing-token",
    });
  });

  it("logs safe diagnostics for invalid Agent JWTs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
    });
    const token = await signAgentToken({
      sub: "user_123",
      scope: "agent:session",
      jti: "jti_http_bad_signature",
      secret: "wrong-web-secret",
    });

    const response = await fetch(server.url("/v1/session"), {
      headers: {
        authorization: `Bearer ${token}`,
        "x-request-id": "req-client-bad-signature",
      },
    });

    expect(response.status).toBe(401);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      level: "warn",
      event: "agent_auth_failure",
      requestId: "req-client-bad-signature",
      path: "/v1/session",
      method: "GET",
      statusCode: 401,
      error: "unauthorized",
      message: "Invalid or expired bearer token",
      diagnosticReason: "signature_verification_failed",
    });
  });

  it("returns a STAR-aware rich text polish result from /v1/rich-text/polish", async () => {
    const provider = new FakeRichTextPolishProvider(
      JSON.stringify({
        polishedText: "负责业务系统前端开发，围绕页面性能瓶颈持续优化加载与交互体验。",
        changeSummary: "按 STAR 思路强化职责与行动表达，未新增结果数据。",
        riskFlags: [
          {
            type: "too_little_context",
            message: "原文缺少可量化结果，已按现有信息保守润色。",
          },
        ],
      }),
    );
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      richTextPolishProvider: provider,
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "rich_text:polish",
      jti: "jti_polish_valid",
    });

    const response = await fetch(server.url("/v1/rich-text/polish"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-polish",
      },
      body: JSON.stringify({
        resumeId: "resume_abc",
        section: "experience",
        fieldPath: "experience.0.content",
        locale: "zh-CN",
        content: {
          format: "tiptap_json",
          plainText: "负责业务系统前端开发，优化页面性能。",
          tiptapJson: { type: "doc", content: [] },
        },
        intent: {
          mode: "polish",
          tone: "professional",
          length: "same",
          strategy: "star",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.request.intent.strategy).toBe("star");
    expect(provider.calls[0]?.prompt.developer).toContain("Result");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      requestId: "req-client-polish",
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
    });
  });

  it("serves cached rich text polish results without calling the provider again", async () => {
    const provider = new FakeRichTextPolishProvider(
      JSON.stringify({
        polishedText: "负责业务系统前端开发，围绕页面性能瓶颈持续优化加载与交互体验。",
        changeSummary: "按 STAR 思路强化职责与行动表达，未新增结果数据。",
        riskFlags: [],
      }),
    );
    const cacheStore = new FakeAiCacheStore();
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      richTextPolishProvider: provider,
      aiCacheStore: cacheStore,
    });
    const firstToken = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "rich_text:polish",
      jti: "jti_polish_cache_first",
    });
    const secondToken = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "rich_text:polish",
      jti: "jti_polish_cache_second",
    });

    const first = await fetch(server.url("/v1/rich-text/polish"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${firstToken}`,
        "content-type": "application/json",
        "x-request-id": "req-client-polish-cache-1",
      },
      body: JSON.stringify(validRichTextPolishBody()),
    });
    const second = await fetch(server.url("/v1/rich-text/polish"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${secondToken}`,
        "content-type": "application/json",
        "x-request-id": "req-client-polish-cache-2",
      },
      body: JSON.stringify(validRichTextPolishBody()),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(cacheStore.entries.size).toBe(1);
    await expect(second.json()).resolves.toMatchObject({
      status: "ok",
      requestId: "req-client-polish-cache-2",
      cached: true,
      cachedAt: "2026-06-05T00:00:00.000Z",
      result: {
        format: "plain_text",
        polishedText: "负责业务系统前端开发，围绕页面性能瓶颈持续优化加载与交互体验。",
      },
    });
  });

  it("rejects rich text polish tokens with the wrong scope", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      richTextPolishProvider: new FakeRichTextPolishProvider("{}"),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:session",
      jti: "jti_polish_wrong_scope",
    });

    const response = await fetch(server.url("/v1/rich-text/polish"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-polish-scope",
      },
      body: JSON.stringify({
        resumeId: "resume_abc",
        section: "experience",
        fieldPath: "experience.0.content",
        locale: "zh-CN",
        content: {
          format: "plain_text",
          plainText: "负责业务系统前端开发。",
        },
        intent: {
          mode: "polish",
          tone: "professional",
          length: "same",
          strategy: "star",
        },
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "forbidden",
      message: "Token scope is not allowed for this route",
      requestId: "req-client-polish-scope",
    });
  });

  it("rejects rich text polish requests whose resumeId does not match the JWT", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      richTextPolishProvider: new FakeRichTextPolishProvider("{}"),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "rich_text:polish",
      jti: "jti_polish_resume_mismatch",
    });

    const response = await fetch(server.url("/v1/rich-text/polish"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-polish-resume",
      },
      body: JSON.stringify({
        resumeId: "resume_other",
        section: "experience",
        fieldPath: "experience.0.content",
        locale: "zh-CN",
        content: {
          format: "plain_text",
          plainText: "负责业务系统前端开发。",
        },
        intent: {
          mode: "polish",
          tone: "professional",
          length: "same",
          strategy: "star",
        },
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "forbidden",
      message: "Token resumeId does not match request resumeId",
      requestId: "req-client-polish-resume",
    });
  });

  it("returns dependency_unavailable when no rich text provider is configured", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "rich_text:polish",
      jti: "jti_polish_no_provider",
    });

    const response = await fetch(server.url("/v1/rich-text/polish"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-polish-provider",
      },
      body: JSON.stringify({
        resumeId: "resume_abc",
        section: "experience",
        fieldPath: "experience.0.content",
        locale: "zh-CN",
        content: {
          format: "plain_text",
          plainText: "负责业务系统前端开发。",
        },
        intent: {
          mode: "polish",
          tone: "professional",
          length: "same",
          strategy: "star",
        },
      }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "dependency_unavailable",
      message: "Rich text polish provider is not configured",
      requestId: "req-client-polish-provider",
      dependency: "provider",
    });
  });

  it("returns structured resume helper suggestions from /v1/resume/helpers/:helperId", async () => {
    const provider = new FakeResumeHelperProvider(
      JSON.stringify({
        summary: "整体内容完整，但工作经历缺少可验证结果。",
        suggestions: [
          {
            id: "sug_experience_result",
            section: "experience",
            fieldPath: "experience",
            severity: "high",
            title: "为工作经历补充可验证结果",
            rationale: "当前经历描述了动作，但没有说明产出或影响。",
            actionLabel: "补充结果",
            example: "如果原文已有真实数据，可以补充加载速度、转化率或交付周期变化。",
            riskFlags: [
              {
                type: "needs_user_fact",
                message: "结果数据必须由用户提供，Agent 不应编造。",
              },
            ],
          },
        ],
      }),
    );
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      resumeHelperProvider: provider,
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "resume:helper",
      jti: "jti_resume_helper_valid",
    });

    const response = await fetch(server.url("/v1/resume/helpers/resume-diagnose"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-helper",
      },
      body: JSON.stringify(validResumeHelperBody()),
    });

    expect(response.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.request.helperId).toBe("resume-diagnose");
    expect(provider.calls[0]?.prompt.system).toContain("不得编造事实");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      requestId: "req-client-helper",
      helperId: "resume-diagnose",
      result: {
        summary: "整体内容完整，但工作经历缺少可验证结果。",
        suggestions: [
          {
            id: "sug_experience_result",
            section: "experience",
            fieldPath: "experience",
            severity: "high",
            title: "为工作经历补充可验证结果",
            rationale: "当前经历描述了动作，但没有说明产出或影响。",
            actionLabel: "补充结果",
            example: "如果原文已有真实数据，可以补充加载速度、转化率或交付周期变化。",
            riskFlags: [
              {
                type: "needs_user_fact",
                message: "结果数据必须由用户提供，Agent 不应编造。",
              },
            ],
          },
        ],
      },
      usage: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 620,
        outputTokens: 180,
      },
    });
  });

  it("serves cached resume helper suggestions without calling the provider again", async () => {
    const provider = new FakeResumeHelperProvider(
      JSON.stringify({
        summary: "整体内容完整，但工作经历缺少可验证结果。",
        suggestions: [],
      }),
    );
    const cacheStore = new FakeAiCacheStore();
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      resumeHelperProvider: provider,
      aiCacheStore: cacheStore,
    });
    const firstToken = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "resume:helper",
      jti: "jti_helper_cache_first",
    });
    const secondToken = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "resume:helper",
      jti: "jti_helper_cache_second",
    });

    const first = await fetch(server.url("/v1/resume/helpers/resume-diagnose"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${firstToken}`,
        "content-type": "application/json",
        "x-request-id": "req-client-helper-cache-1",
      },
      body: JSON.stringify(validResumeHelperBody()),
    });
    const second = await fetch(server.url("/v1/resume/helpers/resume-diagnose"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${secondToken}`,
        "content-type": "application/json",
        "x-request-id": "req-client-helper-cache-2",
      },
      body: JSON.stringify(validResumeHelperBody()),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(cacheStore.entries.size).toBe(1);
    await expect(second.json()).resolves.toMatchObject({
      status: "ok",
      requestId: "req-client-helper-cache-2",
      cached: true,
      cachedAt: "2026-06-05T00:00:00.000Z",
      helperId: "resume-diagnose",
      result: {
        summary: "整体内容完整，但工作经历缺少可验证结果。",
        suggestions: [],
      },
    });
  });

  it("rejects resume helper tokens with the wrong scope", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      resumeHelperProvider: new FakeResumeHelperProvider("{}"),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "rich_text:polish",
      jti: "jti_helper_wrong_scope",
    });

    const response = await fetch(server.url("/v1/resume/helpers/resume-diagnose"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-helper-scope",
      },
      body: JSON.stringify(validResumeHelperBody()),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "forbidden",
      message: "Token scope is not allowed for this route",
      requestId: "req-client-helper-scope",
    });
  });

  it("rejects resume helper requests whose resumeId does not match the JWT", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      resumeHelperProvider: new FakeResumeHelperProvider("{}"),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "resume:helper",
      jti: "jti_helper_resume_mismatch",
    });

    const response = await fetch(server.url("/v1/resume/helpers/resume-diagnose"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-helper-resume",
      },
      body: JSON.stringify({
        ...validResumeHelperBody(),
        resumeId: "resume_other",
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "forbidden",
      message: "Token resumeId does not match request resumeId",
      requestId: "req-client-helper-resume",
    });
  });

  it("returns dependency_unavailable when no resume helper provider is configured", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "resume:helper",
      jti: "jti_helper_no_provider",
    });

    const response = await fetch(server.url("/v1/resume/helpers/resume-diagnose"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-helper-provider",
      },
      body: JSON.stringify(validResumeHelperBody()),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "dependency_unavailable",
      message: "Resume helper provider is not configured",
      requestId: "req-client-helper-provider",
      dependency: "provider",
    });
  });

  it("returns Agent messages, tool calls, and proposed operations from /v1/agent/messages", async () => {
    const provider = new FakeAgentMessageProvider(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "建议先优化第一段工作经历。",
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_update_section",
            status: "completed",
            title: "更新工作经历",
            summary: "将笼统经历改成更清晰的 STAR 表达。",
            input: { fieldPath: "experience.0.content" },
            result: { operationIds: ["op_1"] },
          },
        ],
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "优化工作经历第一段",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责业务系统前端开发，优化页面性能。",
            afterPlainText: "围绕业务系统页面性能瓶颈推进前端优化；结果指标需要补充。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "按 STAR 补足任务与行动，不编造结果。",
            riskFlags: [
              {
                type: "needs_user_fact",
                message: "请补充真实性能提升指标。",
              },
            ],
          },
        ],
      }),
    );
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: provider,
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_valid",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });

    expect(response.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.request.workflowId).toBe("resume-diagnose");
    expect(provider.calls[0]?.prompt.developer).toContain(
      "resume_update_section",
    );
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      requestId: "req-client-agent-message",
      message: {
        id: "msg_assistant_1",
        role: "assistant",
        content: "建议先优化第一段工作经历。",
      },
      toolCalls: [
        {
          id: "tool_1",
          name: "resume_update_section",
          status: "completed",
          title: "更新工作经历",
          summary: "将笼统经历改成更清晰的 STAR 表达。",
          input: { fieldPath: "experience.0.content" },
          result: { operationIds: ["op_1"] },
        },
      ],
      proposedOperations: [
        {
          id: "op_1",
          toolCallId: "tool_1",
          label: "优化工作经历第一段",
          section: "experience",
          fieldPath: "experience.0.content",
          operation: "update_section",
          beforePlainText: "负责业务系统前端开发，优化页面性能。",
          afterPlainText: "围绕业务系统页面性能瓶颈推进前端优化；结果指标需要补充。",
          replacementTiptapJson: { type: "doc", content: [] },
          changeSummary: "按 STAR 补足任务与行动，不编造结果。",
          riskFlags: [
            {
              type: "needs_user_fact",
              message: "请补充真实性能提升指标。",
            },
          ],
        },
      ],
      usage: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 900,
        outputTokens: 240,
      },
    });
  });

  it("records Agent message observability for successful JSON responses", async () => {
    const observability = new FakeAgentObservability();
    const provider = new FakeAgentMessageProvider(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "建议先优化第一段工作经历。",
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_update_section",
            status: "completed",
            title: "更新工作经历",
            summary: "将笼统经历改成更清晰的 STAR 表达。",
            input: { fieldPath: "experience.0.content" },
            result: { operationIds: ["op_1"] },
          },
        ],
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "优化工作经历第一段",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责业务系统前端开发，优化页面性能。",
            afterPlainText: "围绕业务系统页面性能瓶颈推进前端优化；结果指标需要补充。",
            changeSummary: "按 STAR 补足任务与行动，不编造结果。",
            riskFlags: [
              {
                type: "needs_user_fact",
                message: "请补充真实性能提升指标。",
              },
            ],
          },
        ],
      }),
    );
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: provider,
      observability,
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_observed",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-observed",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });

    expect(response.status).toBe(200);
    expect(observability.runs).toHaveLength(1);
    expect(observability.runs[0]).toMatchObject({
      requestId: "req-client-agent-message-observed",
      cacheStatus: "miss",
    });
    expect(observability.generationInputs).toHaveLength(1);
    expect(observability.generationInputs[0]?.prompt.developer).toContain(
      "proposedOperations",
    );
    expect(observability.cacheStatuses).toEqual(["miss"]);
    expect(observability.parseResults).toEqual([
      {
        ok: true,
        toolCallCount: 1,
        proposedOperationCount: 1,
        interruptReasons: ["approval_required"],
      },
    ]);
    expect(observability.runOutputs.at(-1)).toEqual({
      status: "ok",
      toolCallCount: 1,
      proposedOperationCount: 1,
    });
  });

  it("returns conversational Agent messages when provider omits empty tool arrays", async () => {
    const provider = new FakeAgentMessageProvider(
      JSON.stringify({
        message: {
          id: "msg_assistant_followup",
          role: "assistant",
          content: "请确认你想优化第 3 段项目经历吗？",
        },
      }),
    );
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: provider,
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_followup",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-followup",
      },
      body: JSON.stringify({
        ...validAgentMessageBody(),
        messages: [
          { id: "msg_user_1", role: "user", content: "经历 STAR 优化" },
          {
            id: "msg_assistant_1",
            role: "assistant",
            content: "请选择要优化的经历：1. 工作经历 2. 项目经历1 3. 项目经历2",
          },
          { id: "msg_user_2", role: "user", content: "3" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      requestId: "req-client-agent-followup",
      message: {
        id: "msg_assistant_followup",
        role: "assistant",
        content: "请确认你想优化第 3 段项目经历吗？",
      },
      toolCalls: [],
      proposedOperations: [],
      usage: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 900,
        outputTokens: 240,
      },
    });
  });

  it("streams AG-UI events from /v1/agent/messages when requested", async () => {
    const assistantContent =
      "建议先优化第一段工作经历。我会按 STAR 拆成情境、任务、行动与结果，并标记需要你补充的真实指标。";
    const provider = new FakeAgentMessageProvider(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: assistantContent,
        },
        toolCalls: [
          {
            id: "tool_1",
            name: "resume_update_section",
            status: "completed",
            title: "更新工作经历",
            summary: "将笼统经历改成更清晰的 STAR 表达。",
            input: { fieldPath: "experience.0.content" },
            result: { operationIds: ["op_1"] },
          },
        ],
        proposedOperations: [
          {
            id: "op_1",
            toolCallId: "tool_1",
            label: "优化工作经历第一段",
            section: "experience",
            fieldPath: "experience.0.content",
            operation: "update_section",
            beforePlainText: "负责业务系统前端开发，优化页面性能。",
            afterPlainText: "围绕业务系统页面性能瓶颈推进前端优化；结果指标需要补充。",
            replacementTiptapJson: { type: "doc", content: [] },
            changeSummary: "按 STAR 补足任务与行动，不编造结果。",
            riskFlags: [
              {
                type: "needs_user_fact",
                message: "请补充真实性能提升指标。",
              },
            ],
          },
        ],
      }),
    );
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: provider,
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_stream",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-stream",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-request-id")).toBe(
      "req-client-agent-message-stream",
    );
    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    expect(events[1]?.type).toBe(EventType.TEXT_MESSAGE_START);
    expect(events.at(-2)?.type).toBe(EventType.TEXT_MESSAGE_END);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    const textDeltas = events
      .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => event.delta);
    expect(textDeltas.length).toBeGreaterThan(1);
    expect(textDeltas.join("")).toBe(assistantContent);
    expect(events).toContainEqual(expect.objectContaining({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: "tool_1",
      content: expect.stringContaining('"proposedOperations"'),
    }));
  });

  it("streams visible Agent message text before the provider stream finishes", async () => {
    const provider = new StreamingAgentMessageProvider([
      '{"message":{"id":"msg_assistant_1","role":"assistant","content":"实时',
      '吐字。"},"toolCalls":[],"proposedOperations":[]}',
    ]);
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: provider,
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_realtime_stream",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-realtime-stream",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("expected stream reader");

    const prefix = await readStreamUntil(reader, "实时");
    expect(prefix).toContain("实时");
    expect(provider.finished).toBe(false);
    expect(provider.runCalls).toBe(0);

    provider.release();
    const text = prefix + await readRemainingStream(reader);
    const events = parseSseEvents(text);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events
      .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => event.delta)
      .join("")).toBe("实时吐字。");
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("streams tool results instead of RUN_ERROR when provider operations omit toolCallId", async () => {
    const providerContent = JSON.stringify({
      message: {
        id: "msg_assistant_tool_fix",
        role: "assistant",
        content: "以下是我生成的 1 个 proposedOperation，请确认是否应用。",
      },
      toolCalls: [],
      proposedOperations: [
        {
          id: "op_1",
          label: "应用经历改写",
          section: "experience",
          fieldPath: "experience.0.content",
          operation: "update_section",
          beforePlainText: "Token 调用优化降低 200%。",
          afterPlainText: "Token 调用优化提升 200% 效率。",
          replacementTiptapJson: { type: "doc", content: [] },
          changeSummary: "修正指标表述，保留用户确认写回。",
          riskFlags: [],
        },
      ],
    });
    const provider = new StreamingAgentMessageProvider([
      providerContent.slice(0, 96),
      providerContent.slice(96),
    ]);
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: provider,
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_missing_tool_call_id",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-missing-tool-call-id",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    provider.release();
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(events.find((event) => event.type === EventType.RUN_ERROR)).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      outcome: {
        type: "interrupt",
        interrupts: [
          {
            id: "op_1",
            reason: "approval_required",
            toolCallId: "tool_op_1",
          },
        ],
      },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: "tool_op_1",
      content: expect.stringContaining('"toolCallId":"tool_op_1"'),
    }));
  });

  it("streams cached Agent message requests as AG-UI events when requested", async () => {
    const provider = new FakeAgentMessageProvider(
      JSON.stringify({
        message: {
          id: "msg_assistant_cached",
          role: "assistant",
          content: "缓存命中也应该继续走 AG-UI SSE。",
        },
        toolCalls: [],
        proposedOperations: [],
      }),
    );
    const cacheStore = new FakeAiCacheStore();
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: provider,
      aiCacheStore: cacheStore,
    });
    const firstToken = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_sse_cache_first",
    });
    const secondToken = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_sse_cache_second",
    });

    const first = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${firstToken}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-sse-cache-1",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    const second = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${secondToken}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-sse-cache-2",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    const text = await second.text();
    const events = parseSseEvents(text);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("content-type")).toContain("text/event-stream");
    expect(second.headers.get("content-type")).not.toContain("application/json");
    expect(text).toContain("data:");
    expect(provider.calls).toHaveLength(1);
    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(events
      .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => event.delta)
      .join("")).toBe("缓存命中也应该继续走 AG-UI SSE。");
  });

  it("records Agent message cache hits and misses", async () => {
    const observability = new FakeAgentObservability();
    const cache = new FakeAiCacheStore();
    const provider = new FakeAgentMessageProvider(
      JSON.stringify({
        message: {
          id: "msg_cached",
          role: "assistant",
          content: "缓存候选响应。",
        },
        toolCalls: [],
        proposedOperations: [],
      }),
    );
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      aiCacheStore: cache,
      agentMessageProvider: provider,
      observability,
    });
    const firstToken = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_observed_cache_1",
    });
    const secondToken = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_observed_cache_2",
    });

    await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${firstToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${secondToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });

    expect(provider.calls).toHaveLength(1);
    expect(observability.cacheStatuses).toEqual(["miss", "hit"]);
  });

  it("records Agent message parse failures", async () => {
    const observability = new FakeAgentObservability();
    const provider = new FakeAgentMessageProvider("not-json");
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: provider,
      observability,
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_observed_parse_error",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });

    expect(response.status).toBe(503);
    expect(observability.parseResults).toEqual([
      { ok: false, message: "Provider returned invalid JSON" },
    ]);
    expect(observability.runOutputs.at(-1)).toEqual({
      status: "error",
      error: "Provider returned invalid JSON",
    });
  });

  it("streams AG-UI RUN_ERROR when an SSE provider response cannot be parsed", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: new FakeAgentMessageProvider("not-json"),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_stream_parse_error",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-stream-parse-error",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      message: "Provider returned invalid JSON",
      code: "dependency_unavailable",
    });
  });

  it("streams AG-UI RUN_ERROR when an SSE provider throws", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: new ThrowingAgentMessageProvider("Provider exploded"),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_stream_throw",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-stream-throw",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      message: "Provider exploded",
      code: "dependency_unavailable",
    });
  });

  it("serves identical Agent message requests from cache", async () => {
    const provider = new FakeAgentMessageProvider(
      JSON.stringify({
        message: {
          id: "msg_assistant_1",
          role: "assistant",
          content: "建议先优化第一段工作经历。",
        },
        toolCalls: [],
        proposedOperations: [],
      }),
    );
    const cacheStore = new FakeAiCacheStore();
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: provider,
      aiCacheStore: cacheStore,
    });
    const firstToken = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_cache_first",
    });
    const secondToken = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_cache_second",
    });

    const first = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${firstToken}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-cache-1",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    const second = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${secondToken}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-cache-2",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(provider.calls).toHaveLength(1);
    expect(cacheStore.entries.size).toBe(1);
    await expect(second.json()).resolves.toMatchObject({
      status: "ok",
      requestId: "req-client-agent-message-cache-2",
      cached: true,
      cachedAt: "2026-06-05T00:00:00.000Z",
      message: {
        id: "msg_assistant_1",
        role: "assistant",
        content: "建议先优化第一段工作经历。",
      },
      toolCalls: [],
      proposedOperations: [],
    });
  });

  it("rejects Agent message tokens with the wrong scope", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: new FakeAgentMessageProvider("{}"),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "resume:helper",
      jti: "jti_agent_message_wrong_scope",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-scope",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "forbidden",
      message: "Token scope is not allowed for this route",
      requestId: "req-client-agent-message-scope",
    });
  });

  it("rejects Agent message requests whose resumeId does not match the JWT", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: new FakeAgentMessageProvider("{}"),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_resume_mismatch",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-resume",
      },
      body: JSON.stringify({
        ...validAgentMessageBody(),
        resumeId: "resume_other",
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "forbidden",
      message: "Token resumeId does not match request resumeId",
      requestId: "req-client-agent-message-resume",
    });
  });

  it("returns dependency_unavailable when no Agent message provider is configured", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_no_provider",
    });

    const response = await fetch(server.url("/v1/agent/messages"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-provider",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "dependency_unavailable",
      message: "Agent message provider is not configured",
      requestId: "req-client-agent-message-provider",
      dependency: "provider",
    });
  });
});

async function listenOnRandomPort(
  options: {
    redisReady?: () => Promise<{ ok: true } | { ok: false; message: string }>;
    replayStore?: AgentReplayStore;
    richTextPolishProvider?: RichTextPolishProvider;
    resumeHelperProvider?: ResumeHelperProvider;
    agentMessageProvider?: AgentMessageProvider;
    aiCacheStore?: AiCacheStore;
    observability?: AgentObservability;
  } = {},
): Promise<TestAgentServer> {
  const server = createAgentServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      serviceName: "intro-agent-test",
      version: "test-version",
      nodeEnv: "test",
      shutdownTimeoutMs: 100,
      redisUrl: "redis://127.0.0.1:6379",
      redisConnectTimeoutMs: 100,
      rateLimitWindowSeconds: 60,
      rateLimitMaxRequests: 30,
      jwtIssuer: "intro-builder-web",
      jwtAudience: "intro-builder-agent",
      jwtSecret: "test-agent-secret",
      jwtReplayTtlSeconds: 180,
      modelBaseUrl: undefined,
      modelApiKey: undefined,
      modelName: undefined,
      modelTimeoutMs: 20_000,
      langfuse: {
        enabled: false,
        publicKey: undefined,
        secretKey: undefined,
        baseUrl: "https://cloud.langfuse.com",
        environment: "test",
        release: "test-version",
        timeoutSeconds: 5,
        sampleRate: 1,
        captureRawPayloads: false,
      },
    },
    now: () => new Date("2026-06-05T00:00:00.000Z"),
    uptimeSeconds: () => 42,
    redisReady: options.redisReady ?? (async () => ({ ok: true })),
    replayStore: options.replayStore,
    richTextPolishProvider: options.richTextPolishProvider,
    resumeHelperProvider: options.resumeHelperProvider,
    agentMessageProvider: options.agentMessageProvider,
    aiCacheStore: options.aiCacheStore,
    observability: options.observability,
    createRequestId: () => "req_test_1",
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address() as AddressInfo;
  const testServer = Object.assign(server, {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
  });

  servers.push(testServer);

  return testServer;
}

function validRichTextPolishBody() {
  return {
    resumeId: "resume_abc",
    section: "experience",
    fieldPath: "experience.0.content",
    locale: "zh-CN",
    content: {
      format: "tiptap_json",
      plainText: "负责业务系统前端开发，优化页面性能。",
      tiptapJson: { type: "doc", content: [] },
    },
    intent: {
      mode: "polish",
      tone: "professional",
      length: "same",
      strategy: "star",
    },
  };
}

function validResumeHelperBody() {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN",
    target: {
      kind: "resume",
      section: null,
      fieldPath: null,
    },
    context: {
      resumeTitle: "前端开发工程师",
      completeness: {
        overall: 68,
        sections: [
          { key: "experience", label: "工作经历", score: 7, max: 10 },
        ],
      },
      sections: [
        {
          key: "experience",
          label: "工作经历",
          plainText: "负责业务系统前端开发，优化页面性能。",
        },
      ],
    },
    intent: {
      mode: "diagnose",
      maxSuggestions: 5,
      strategy: "star",
    },
  };
}

function validAgentMessageBody() {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN",
    workflowId: "resume-diagnose",
    messages: [{ id: "msg_user_1", role: "user", content: "诊断整份简历" }],
    context: {
      resumeTitle: "前端开发工程师",
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
  };
}

async function signAgentToken({
  sub,
  scope,
  jti,
  resumeId,
  secret = "test-agent-secret",
}: {
  sub: string;
  scope: string;
  jti: string;
  resumeId?: string;
  secret?: string;
}): Promise<string> {
  const now = new Date("2026-06-08T08:00:00.000Z");
  const expiresAt = new Date("2026-06-08T08:02:00.000Z");

  return new SignJWT({
    scope,
    ...(resumeId ? { resumeId } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("intro-builder-web")
    .setAudience("intro-builder-agent")
    .setSubject(sub)
    .setJti(jti)
    .setIssuedAt(Math.floor(now.getTime() / 1_000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
    .sign(new TextEncoder().encode(secret));
}

class FakeReplayStore implements AgentReplayStore {
  private keys = new Set<string>();

  async set(
    key: string,
    _value: string,
    options: { NX: true; EX: number },
  ): Promise<"OK" | null> {
    void options;
    if (this.keys.has(key)) return null;
    this.keys.add(key);
    return "OK";
  }
}

class FakeAiCacheStore implements AiCacheStore {
  readonly entries = new Map<string, AiCacheEntry>();

  async get<T = unknown>(key: string): Promise<AiCacheEntry<T> | null> {
    return (this.entries.get(key) as AiCacheEntry<T> | undefined) ?? null;
  }

  async set<T = unknown>(
    key: string,
    entry: AiCacheEntry<T>,
  ): Promise<void> {
    this.entries.set(key, entry as AiCacheEntry);
  }
}

class FakeRichTextPolishProvider implements RichTextPolishProvider {
  readonly calls: Array<{
    request: Parameters<RichTextPolishProvider["polish"]>[0]["request"];
    prompt: Parameters<RichTextPolishProvider["polish"]>[0]["prompt"];
  }> = [];

  constructor(private readonly content: string) {}

  async polish(options: Parameters<RichTextPolishProvider["polish"]>[0]) {
    this.calls.push({ request: options.request, prompt: options.prompt });
    return {
      content: this.content,
      usage: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 120,
        outputTokens: 36,
      },
    };
  }
}

class FakeResumeHelperProvider implements ResumeHelperProvider {
  readonly calls: Array<{
    request: Parameters<ResumeHelperProvider["run"]>[0]["request"];
    prompt: Parameters<ResumeHelperProvider["run"]>[0]["prompt"];
  }> = [];

  constructor(private readonly content: string) {}

  async run(options: Parameters<ResumeHelperProvider["run"]>[0]) {
    this.calls.push({ request: options.request, prompt: options.prompt });
    return {
      content: this.content,
      usage: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 620,
        outputTokens: 180,
      },
    };
  }
}

class FakeAgentMessageProvider implements AgentMessageProvider {
  readonly calls: Array<{
    request: Parameters<AgentMessageProvider["run"]>[0]["request"];
    prompt: Parameters<AgentMessageProvider["run"]>[0]["prompt"];
  }> = [];

  constructor(private readonly content: string) {}

  async run(options: Parameters<AgentMessageProvider["run"]>[0]) {
    this.calls.push({ request: options.request, prompt: options.prompt });
    return {
      content: this.content,
      usage: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 900,
        outputTokens: 240,
      },
    };
  }
}

class FakeAgentObservability implements AgentObservability {
  enabled = true;
  readonly runs: AgentMessageTraceContext[] = [];
  readonly cacheStatuses: AgentCacheStatus[] = [];
  readonly parseResults: AgentMessageParseTrace[] = [];
  readonly runOutputs: Array<Parameters<AgentMessageTrace["recordRunOutput"]>[0]> = [];
  readonly generationInputs: AgentMessageGenerationTraceInput[] = [];

  async traceAgentMessageRun<T>(
    context: AgentMessageTraceContext,
    run: (trace: AgentMessageTrace) => Promise<T>,
  ): Promise<T> {
    this.runs.push(context);
    return run({
      recordCache: (status) => {
        this.cacheStatuses.push(status);
      },
      recordParseResult: (result) => {
        this.parseResults.push(result);
      },
      recordRunOutput: (output) => {
        this.runOutputs.push(output);
      },
      traceGeneration: async (input, callback) => {
        this.generationInputs.push(input);
        return callback();
      },
    });
  }

  async flush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}

class ThrowingAgentMessageProvider implements AgentMessageProvider {
  readonly calls: Array<{
    request: Parameters<AgentMessageProvider["run"]>[0]["request"];
    prompt: Parameters<AgentMessageProvider["run"]>[0]["prompt"];
  }> = [];

  constructor(private readonly message: string) {}

  run(
    options: Parameters<AgentMessageProvider["run"]>[0],
  ): ReturnType<AgentMessageProvider["run"]> {
    this.calls.push({ request: options.request, prompt: options.prompt });
    return Promise.reject(new Error(this.message));
  }
}

class StreamingAgentMessageProvider implements AgentMessageProvider {
  runCalls = 0;
  finished = false;
  private releaseStream!: () => void;
  private readonly releasePromise = new Promise<void>((resolve) => {
    this.releaseStream = resolve;
  });

  constructor(private readonly chunks: string[]) {}

  async run(): ReturnType<AgentMessageProvider["run"]> {
    this.runCalls += 1;
    throw new Error("run should not be used for SSE streaming providers");
  }

  async *stream(): AsyncIterable<
    | { type: "content_delta"; delta: string }
    | {
        type: "usage";
        usage: {
          provider: string;
          model: string;
          inputTokens: number;
          outputTokens: number;
        };
      }
  > {
    yield { type: "content_delta", delta: this.chunks[0] ?? "" };
    await this.releasePromise;
    yield { type: "content_delta", delta: this.chunks[1] ?? "" };
    yield {
      type: "usage",
      usage: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 900,
        outputTokens: 240,
      },
    };
    this.finished = true;
  }

  release(): void {
    this.releaseStream();
  }
}

async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  text: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  for (let index = 0; index < 20; index += 1) {
    const { done, value } = await reader.read();
    if (done) return output;
    output += decoder.decode(value, { stream: true });
    if (output.includes(text)) return output;
  }
  throw new Error(`Stream did not include ${text}`);
}

async function readRemainingStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return output + decoder.decode();
    output += decoder.decode(value, { stream: true });
  }
}

function parseSseEvents(text: string): BaseEvent[] {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const data = chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      const result = BaseEventSchema.safeParse(JSON.parse(data));
      if (!result.success) throw result.error;
      return result.data;
    });
}
