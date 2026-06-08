import { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentReplayStore } from "../src/auth";
import { createAgentServer } from "../src/http";
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
});

async function listenOnRandomPort(
  options: {
    redisReady?: () => Promise<{ ok: true } | { ok: false; message: string }>;
    replayStore?: AgentReplayStore;
    richTextPolishProvider?: RichTextPolishProvider;
    resumeHelperProvider?: ResumeHelperProvider;
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
    },
    now: () => new Date("2026-06-05T00:00:00.000Z"),
    uptimeSeconds: () => 42,
    redisReady: options.redisReady ?? (async () => ({ ok: true })),
    replayStore: options.replayStore,
    richTextPolishProvider: options.richTextPolishProvider,
    resumeHelperProvider: options.resumeHelperProvider,
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
