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
import type {
  AgentSessionStore,
  AppendAgentSessionEventsInput,
  LoadAgentSessionSnapshotInput,
} from "../src/session-store";

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

  it("returns Agent messages, tool calls, and proposed operations from /v1/agent/chat", async () => {
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

    const response = await fetch(server.url("/v1/agent/chat"), {
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

    const response = await fetch(server.url("/v1/agent/chat"), {
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

    const response = await fetch(server.url("/v1/agent/chat"), {
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

  it("streams AG-UI events from the Agent loop when model config is present", async () => {
    const assistantContent = "我会先检查内容结构。";
    const providerFetch = mockOpenAiCompatibleChatStream(["我会先", "检查内容结构。"]);
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_loop_stream",
    });

    const response = await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-loop-stream",
      },
      body: JSON.stringify(withModelConfig(validAgentMessageBody())),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-request-id")).toBe(
      "req-client-agent-loop-stream",
    );
    expect(providerFetch).toHaveBeenCalledWith(
      "https://models.example.test/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer sk-request-scoped",
        }),
      }),
    );
    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    const textStartIndex = events.findIndex(
      (event) => event.type === EventType.TEXT_MESSAGE_START,
    );
    const contextStatusIndex = events.findIndex(
      (event) =>
        event.type === EventType.STATE_DELTA &&
        event.delta.some((patch) => patch.path === "/contextStatus"),
    );
    const contextActivityIndex = events.findIndex(
      (event) =>
        event.type === EventType.ACTIVITY_SNAPSHOT &&
        event.activityType === "context_status",
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        type: EventType.STATE_SNAPSHOT,
        snapshot: {
          contextStatus: null,
          workspace: null,
          workflow: {
            workflowId: "resume-diagnose",
            nodeId: "intake_goal",
            loopCount: 0,
            completedNodeIds: [],
          },
        },
      }),
    );
    expect(events[contextStatusIndex]).toEqual(
      expect.objectContaining({
        type: EventType.STATE_DELTA,
        delta: [
          expect.objectContaining({
            path: "/contextStatus",
            value: expect.objectContaining({
              effectiveInputBudgetTokens: 200_000,
            }),
          }),
        ],
      }),
    );
    expect(events[contextActivityIndex]).toEqual(
      expect.objectContaining({
        type: EventType.ACTIVITY_SNAPSHOT,
        activityType: "context_status",
      }),
    );
    expect(contextStatusIndex).toBeGreaterThan(1);
    expect(contextActivityIndex).toBeGreaterThan(1);
    expect(textStartIndex).toBeGreaterThan(contextActivityIndex);
    expect(events.at(-2)?.type).toBe(EventType.TEXT_MESSAGE_END);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    const textDeltas = events
      .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => event.delta);
    expect(textDeltas.length).toBeGreaterThan(1);
    expect(textDeltas.join("")).toBe(assistantContent);
  });

  it("streams completed loop tool results and workspace deltas before final assistant text", async () => {
    mockOpenAiCompatibleToolLoopStream({
      toolCall: {
        id: "call_update_summary",
        name: "resume_update_section",
        arguments: {
          fieldPath: "basics.summary",
          label: "个人简介",
          newContent: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "三年前端经验，擅长性能优化。" }],
              },
            ],
          },
        },
      },
      finalChunks: ["已完成", "草稿更新。"],
    });
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_loop_step_stream",
    });

    const response = await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-loop-step-stream",
      },
      body: JSON.stringify(withModelConfig(validAgentMessageBody())),
    });
    const events = parseSseEvents(await response.text());

    const toolResultIndex = events.findIndex(
      (event) =>
        event.type === EventType.TOOL_CALL_RESULT &&
        event.toolCallId === "call_update_summary",
    );
    const workspaceDeltaIndex = events.findIndex(
      (event) =>
        event.type === EventType.STATE_DELTA &&
        event.delta.some((patch) => patch.path === "/workspace"),
    );
    const textStartIndex = events.findIndex(
      (event) => event.type === EventType.TEXT_MESSAGE_START,
    );
    const runFinishedIndex = events.findIndex(
      (event) => event.type === EventType.RUN_FINISHED,
    );

    expect(toolResultIndex).toBeGreaterThan(0);
    expect(workspaceDeltaIndex).toBeGreaterThan(toolResultIndex);
    expect(toolResultIndex).toBeLessThan(textStartIndex);
    expect(workspaceDeltaIndex).toBeLessThan(textStartIndex);
    expect(workspaceDeltaIndex).toBeLessThan(runFinishedIndex);
    expect(events[toolResultIndex]).toEqual(
      expect.objectContaining({
        type: EventType.TOOL_CALL_RESULT,
        content: expect.stringContaining("三年前端经验"),
      }),
    );
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

    await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${firstToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    await fetch(server.url("/v1/agent/chat"), {
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

    const response = await fetch(server.url("/v1/agent/chat"), {
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

    const first = await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${firstToken}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-cache-1",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });
    const second = await fetch(server.url("/v1/agent/chat"), {
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

    const response = await fetch(server.url("/v1/agent/chat"), {
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

    const response = await fetch(server.url("/v1/agent/chat"), {
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

  it("accepts create-from-zero Agent messages without a resume-scoped JWT", async () => {
    mockOpenAiCompatibleChatStream(["我先确认目标岗位和基础资料。"]);
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
    });
    const token = await signAgentToken({
      sub: "user_123",
      scope: "agent:chat",
      jti: "jti_agent_message_create_zero",
    });

    const response = await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-create-zero",
      },
      body: JSON.stringify(withModelConfig({
        resumeId: null,
        mode: "create_from_zero",
        locale: "zh-CN",
        workflowId: "create-from-zero",
        messages: [
          {
            id: "msg_user_create",
            role: "user",
            content: "从 0 帮我做一份前端工程师简历",
          },
        ],
        context: null,
      })),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(events[0]).toMatchObject({
      type: EventType.RUN_STARTED,
      threadId: "agent_create_from_zero",
      runId: "req-client-agent-message-create-zero",
    });
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      threadId: "agent_create_from_zero",
      runId: "req-client-agent-message-create-zero",
    });
  });

  it("allows configured browser origins to preflight direct Agent message streams", async () => {
    const server = await listenOnRandomPort({
      corsOrigins: ["http://localhost:3000"],
    });

    const response = await fetch(server.url("/v1/agent/chat"), {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type,accept",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("persists direct Agent stream events and snapshots in the Agent session store", async () => {
    mockOpenAiCompatibleChatStream(["我会先生成一条可预览的修改建议。"]);
    const sessionStore = new FakeAgentSessionStore();
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      sessionStore,
      corsOrigins: ["http://localhost:3000"],
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_direct_persist",
    });

    const response = await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-request-id": "req-client-agent-message-direct-persist",
      },
      body: JSON.stringify(withModelConfig({
        ...validAgentMessageBody(),
        sessionContext: {
          sessionId: "agent_session_resume_abc_resume_abc",
          threadId: "resume_abc",
          resumeId: "resume_abc",
          mode: "optimize_existing",
          workflowId: "resume-diagnose",
          resumeTitle: "前端工程师",
        },
      })),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(sessionStore.loadCalls).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({
          sessionId: "agent_session_resume_abc_resume_abc",
          threadId: "resume_abc",
        }),
      }),
    ]);
    expect(sessionStore.appendedEvents.map((event) => event.type)).toEqual(
      events.map((event) => event.type),
    );
    expect(sessionStore.snapshots.at(-1)).toEqual(
      expect.objectContaining({
        sessionId: "agent_session_resume_abc_resume_abc",
        threadId: "resume_abc",
        resumeId: "resume_abc",
        status: "active",
      }),
    );
  });

  it("persists resume_ask interrupts as waiting_user session snapshots", async () => {
    mockOpenAiCompatibleToolLoopStream({
      toolCall: {
        id: "call_resume_ask",
        name: "resume_ask",
        arguments: {
          question: "这个项目最终提升了哪些指标？",
          field: "experience.0.content",
        },
      },
      finalChunks: ["不应继续生成。"],
    });
    const sessionStore = new FakeAgentSessionStore();
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      sessionStore,
      corsOrigins: ["http://localhost:3000"],
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_ask_persist",
    });

    const response = await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-request-id": "req-client-agent-message-ask-persist",
      },
      body: JSON.stringify(withModelConfig({
        ...validAgentMessageBody(),
        sessionContext: {
          sessionId: "agent_session_resume_abc_resume_abc",
          threadId: "resume_abc",
          resumeId: "resume_abc",
          mode: "optimize_existing",
          workflowId: "experience-star",
          resumeTitle: "前端工程师",
        },
        workflowId: "experience-star",
      })),
    });
    const events = parseSseEvents(await response.text());
    const runFinished = events.find((event) => event.type === EventType.RUN_FINISHED);

    expect(response.status).toBe(200);
    expect(runFinished).toEqual(
      expect.objectContaining({
        outcome: {
          type: "interrupt",
          interrupts: [
            expect.objectContaining({
              id: "question_1",
              reason: "input_required",
              message: "这个项目最终提升了哪些指标？",
              metadata: { kind: "question", field: "experience.0.content" },
            }),
          ],
        },
      }),
    );
    expect(sessionStore.snapshots.at(-1)).toEqual(
      expect.objectContaining({
        status: "waiting_user",
        pendingInterrupts: [
          expect.objectContaining({
            id: "question_1",
            reason: "input_required",
            message: "这个项目最终提升了哪些指标？",
          }),
        ],
      }),
    );
  });

  it("rejects direct Agent message requests with forged session ids", async () => {
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      agentMessageProvider: new FakeAgentMessageProvider("{}"),
      sessionStore: new FakeAgentSessionStore(),
      corsOrigins: ["http://localhost:3000"],
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_forged_session",
    });

    const response = await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-request-id": "req-client-agent-message-forged-session",
      },
      body: JSON.stringify({
        ...validAgentMessageBody(),
        sessionContext: {
          sessionId: "agent_session_resume_other",
          threadId: "resume_abc",
          resumeId: "resume_abc",
          mode: "optimize_existing",
          workflowId: "resume-diagnose",
          resumeTitle: "前端工程师",
        },
      }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    await expect(response.json()).resolves.toEqual({
      error: "forbidden",
      message: "Token resumeId does not match request resumeId",
      requestId: "req-client-agent-message-forged-session",
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

    const response = await fetch(server.url("/v1/agent/chat"), {
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

  it("returns dependency_unavailable instead of falling back to the legacy provider when model config is missing", async () => {
    const provider = new FakeAgentMessageProvider(
      JSON.stringify({
        message: {
          id: "msg_legacy_provider",
          role: "assistant",
          content: "旧 provider 不应该接管 Agent loop。",
        },
        toolCalls: [],
        proposedOperations: [],
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
      jti: "jti_agent_message_no_model_config",
    });

    const response = await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-no-model-config",
      },
      body: JSON.stringify(validAgentMessageBody()),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(provider.calls).toHaveLength(0);
    await expect(response.json()).resolves.toEqual({
      error: "dependency_unavailable",
      message: "Agent model config is not configured",
      requestId: "req-client-agent-message-no-model-config",
      dependency: "model",
    });
  });

  it("uses request-scoped model settings for Agent loop streams", async () => {
    const providerFetch = mockOpenAiCompatibleChatStream([
      "我会使用你设置的模型继续。",
    ]);
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_model_settings",
    });

    const response = await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-model-settings",
      },
      body: JSON.stringify(withModelConfig(validAgentMessageBody())),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events
      .filter((event) => event.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => event.delta)
      .join("")).toBe("我会使用你设置的模型继续。");
    expect(providerFetch).toHaveBeenCalledWith(
      "https://models.example.test/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer sk-request-scoped",
        }),
      }),
    );
  });

  it("rejects unsafe request-scoped model URLs before any provider fetch", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((async (input, init) => {
        return originalFetch(input, init);
      }) as typeof fetch);
    const server = await listenOnRandomPort({
      replayStore: new FakeReplayStore(),
      aiCacheStore: new FakeAiCacheStore(),
    });
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:chat",
      jti: "jti_agent_message_unsafe_model_settings",
    });

    const response = await fetch(server.url("/v1/agent/chat"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": "req-client-agent-message-unsafe-model-settings",
      },
      body: JSON.stringify({
        ...validAgentMessageBody(),
        modelConfig: {
          baseUrl: "http://127.0.0.1:11434/v1",
          apiKey: "sk-request-scoped",
          modelName: "gpt-5-mini",
        },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "modelConfig.baseUrl is not allowed",
      requestId: "req-client-agent-message-unsafe-model-settings",
    });
    expect(
      fetchSpy.mock.calls.some(([input]) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return url === "http://127.0.0.1:11434/v1/chat/completions";
      }),
    ).toBe(false);
  });
});

async function listenOnRandomPort(
  options: {
    redisReady?: () => Promise<{ ok: true } | { ok: false; message: string }>;
    replayStore?: AgentReplayStore;
    corsOrigins?: string[];
    richTextPolishProvider?: RichTextPolishProvider;
    resumeHelperProvider?: ResumeHelperProvider;
    agentMessageProvider?: AgentMessageProvider;
    aiCacheStore?: AiCacheStore;
    sessionStore?: AgentSessionStore;
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
      corsOrigins: options.corsOrigins ?? [],
      modelBaseUrl: undefined,
      modelApiKey: undefined,
      modelName: undefined,
      modelTimeoutMs: 20_000,
      agentLoopMaxSteps: 16,
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
    sessionStore: options.sessionStore,
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

function withModelConfig<T extends Record<string, unknown>>(body: T): T & {
  modelConfig: { baseUrl: string; apiKey: string; modelName: string };
} {
  return {
    ...body,
    modelConfig: {
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-request-scoped",
      modelName: "gpt-5-mini",
    },
  };
}

function mockOpenAiCompatibleChatStream(chunks: string[]) {
  const originalFetch = globalThis.fetch;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url !== "https://models.example.test/v1/chat/completions") {
        return originalFetch(input, init);
      }

      return new Response(openAiCompatibleSsePayload(chunks), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch);
}

function mockOpenAiCompatibleToolLoopStream({
  toolCall,
  finalChunks,
}: {
  toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };
  finalChunks: string[];
}) {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url !== "https://models.example.test/v1/chat/completions") {
        return originalFetch(input, init);
      }

      callCount += 1;
      return new Response(
        callCount === 1
          ? openAiCompatibleToolCallSsePayload(toolCall)
          : openAiCompatibleSsePayload(finalChunks),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );
    }) as typeof fetch);
}

function openAiCompatibleToolCallSsePayload(toolCall: {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}): string {
  const events = [
    {
      id: "chatcmpl_tool_test",
      object: "chat.completion.chunk",
      created: 1_780_000_000,
      model: "gpt-5-mini",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: toolCall.id,
                type: "function",
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.arguments),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: "chatcmpl_tool_test",
      object: "chat.completion.chunk",
      created: 1_780_000_000,
      model: "gpt-5-mini",
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "tool_calls",
        },
      ],
    },
  ];

  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

function openAiCompatibleSsePayload(chunks: string[]): string {
  const events: Array<Record<string, unknown>> = chunks.map((content, index) => ({
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 1_780_000_000,
    model: "gpt-5-mini",
    choices: [
      {
        index: 0,
        delta: {
          ...(index === 0 ? { role: "assistant" } : {}),
          content,
        },
        finish_reason: null,
      },
    ],
  }));
  events.push({
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 1_780_000_000,
    model: "gpt-5-mini",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 128,
      completion_tokens: chunks.join("").length,
    },
  });

  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
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

class FakeAgentSessionStore implements AgentSessionStore {
  readonly loadCalls: LoadAgentSessionSnapshotInput[] = [];
  readonly appendCalls: AppendAgentSessionEventsInput[] = [];
  readonly appendedEvents: BaseEvent[] = [];
  readonly snapshots: Array<AppendAgentSessionEventsInput["snapshot"]> = [];

  async loadSnapshot(
    input: LoadAgentSessionSnapshotInput,
  ): Promise<null> {
    this.loadCalls.push(input);
    return null;
  }

  async appendEvents(input: AppendAgentSessionEventsInput): Promise<void> {
    this.appendCalls.push(input);
    this.appendedEvents.push(...input.events.map((event) => event.payload));
    this.snapshots.push(input.snapshot);
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
