import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { authenticateAgentRequest, type AgentReplayStore } from "../src/auth";
import type { AgentConfig } from "../src/config";

const NOW = new Date("2026-06-08T08:00:00.000Z");
const EXPIRES_AT = new Date("2026-06-08T08:02:00.000Z");

describe("agent JWT authentication", () => {
  it("accepts a valid short-lived token and reserves its jti", async () => {
    const replayStore = new FakeReplayStore();
    const token = await signAgentToken({
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:session",
      jti: "jti_valid",
    });

    const result = await authenticateAgentRequest({
      authorizationHeader: `Bearer ${token}`,
      expectedScope: "agent:session",
      config: createConfig(),
      replayStore,
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      session: {
        userId: "user_123",
        resumeId: "resume_abc",
        scope: "agent:session",
        jti: "jti_valid",
        expiresAt: EXPIRES_AT,
      },
    });
    expect(replayStore.reserved).toEqual([
      {
        key: "auth:jti:jti_valid",
        ttlSeconds: 180,
      },
    ]);
  });

  it("rejects requests without a bearer token", async () => {
    await expectAuthFailure({
      authorizationHeader: undefined,
      expected: {
        statusCode: 401,
        error: "unauthorized",
        message: "Missing bearer token",
      },
    });
  });

  it("rejects expired tokens", async () => {
    const token = await signAgentToken({
      sub: "user_123",
      scope: "agent:session",
      jti: "jti_expired",
      expiresAt: new Date("2026-06-08T07:59:00.000Z"),
    });

    await expectAuthFailure({
      authorizationHeader: `Bearer ${token}`,
      expected: {
        statusCode: 401,
        error: "unauthorized",
        message: "Invalid or expired bearer token",
      },
    });
  });

  it("rejects tokens with the wrong issuer or audience", async () => {
    const wrongIssuer = await signAgentToken({
      sub: "user_123",
      scope: "agent:session",
      jti: "jti_wrong_issuer",
      issuer: "other-web",
    });
    const wrongAudience = await signAgentToken({
      sub: "user_123",
      scope: "agent:session",
      jti: "jti_wrong_audience",
      audience: "other-agent",
    });

    await expectAuthFailure({
      authorizationHeader: `Bearer ${wrongIssuer}`,
      expected: {
        statusCode: 401,
        error: "unauthorized",
        message: "Invalid or expired bearer token",
      },
    });
    await expectAuthFailure({
      authorizationHeader: `Bearer ${wrongAudience}`,
      expected: {
        statusCode: 401,
        error: "unauthorized",
        message: "Invalid or expired bearer token",
      },
    });
  });

  it("rejects tokens with the wrong scope", async () => {
    const token = await signAgentToken({
      sub: "user_123",
      scope: "rich_text:polish",
      jti: "jti_wrong_scope",
    });

    await expectAuthFailure({
      authorizationHeader: `Bearer ${token}`,
      expected: {
        statusCode: 403,
        error: "forbidden",
        message: "Token scope is not allowed for this route",
      },
    });
  });

  it("rejects replayed jti values", async () => {
    const replayStore = new FakeReplayStore();
    const token = await signAgentToken({
      sub: "user_123",
      scope: "agent:session",
      jti: "jti_replayed",
    });

    await authenticateAgentRequest({
      authorizationHeader: `Bearer ${token}`,
      expectedScope: "agent:session",
      config: createConfig(),
      replayStore,
      now: NOW,
    });
    const result = await authenticateAgentRequest({
      authorizationHeader: `Bearer ${token}`,
      expectedScope: "agent:session",
      config: createConfig(),
      replayStore,
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 401,
      error: "unauthorized",
      message: "Bearer token has already been used",
    });
  });

  it("fails closed when the signing secret is not configured", async () => {
    const token = await signAgentToken({
      sub: "user_123",
      scope: "agent:session",
      jti: "jti_missing_secret",
    });

    const result = await authenticateAgentRequest({
      authorizationHeader: `Bearer ${token}`,
      expectedScope: "agent:session",
      config: {
        ...createConfig(),
        jwtSecret: undefined,
      },
      replayStore: new FakeReplayStore(),
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 503,
      error: "dependency_unavailable",
      message: "JWT secret is not configured",
      dependency: "config",
    });
  });

  it("fails closed when the replay guard is unavailable", async () => {
    const token = await signAgentToken({
      sub: "user_123",
      scope: "agent:session",
      jti: "jti_store_down",
    });

    const result = await authenticateAgentRequest({
      authorizationHeader: `Bearer ${token}`,
      expectedScope: "agent:session",
      config: createConfig(),
      replayStore: {
        set: async () => {
          throw new Error("Redis down");
        },
      },
      now: NOW,
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 503,
      error: "dependency_unavailable",
      message: "JWT replay guard is unavailable",
      dependency: "redis",
    });
  });
});

async function expectAuthFailure({
  authorizationHeader,
  expected,
}: {
  authorizationHeader: string | undefined;
  expected: {
    statusCode: number;
    error: string;
    message: string;
  };
}): Promise<void> {
  const result = await authenticateAgentRequest({
    authorizationHeader,
    expectedScope: "agent:session",
    config: createConfig(),
    replayStore: new FakeReplayStore(),
    now: NOW,
  });

  expect(result).toEqual({
    ok: false,
    ...expected,
  });
}

async function signAgentToken({
  sub,
  scope,
  jti,
  resumeId,
  issuer = "intro-builder-web",
  audience = "intro-builder-agent",
  expiresAt = EXPIRES_AT,
}: {
  sub: string;
  scope: string;
  jti: string;
  resumeId?: string;
  issuer?: string;
  audience?: string;
  expiresAt?: Date;
}): Promise<string> {
  return new SignJWT({
    scope,
    ...(resumeId ? { resumeId } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(sub)
    .setJti(jti)
    .setIssuedAt(Math.floor(NOW.getTime() / 1_000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
    .sign(new TextEncoder().encode("test-agent-secret"));
}

function createConfig(): AgentConfig {
  return {
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
  };
}

class FakeReplayStore implements AgentReplayStore {
  reserved: Array<{ key: string; ttlSeconds: number }> = [];
  private keys = new Set<string>();

  async set(
    key: string,
    _value: string,
    options: { NX: true; EX: number },
  ): Promise<"OK" | null> {
    if (this.keys.has(key)) return null;
    this.keys.add(key);
    this.reserved.push({ key, ttlSeconds: options.EX });
    return "OK";
  }
}
