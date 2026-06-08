import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({ currentUserId: vi.fn() }));
vi.mock("@/lib/agent/token", () => ({ signAgentToken: vi.fn() }));
vi.mock("@/lib/agent/client", () => ({
  AgentClientError: class AgentClientError extends Error {
    statusCode: number;
    error: string;
    requestId: string;

    constructor(
      message: string,
      options: { statusCode: number; error: string; requestId: string },
    ) {
      super(message);
      this.name = "AgentClientError";
      this.statusCode = options.statusCode;
      this.error = options.error;
      this.requestId = options.requestId;
    }
  },
  createAgentClient: vi.fn(),
}));

import { currentUserId } from "@/lib/auth-helpers";
import { signAgentToken } from "@/lib/agent/token";
import { AgentClientError, createAgentClient } from "@/lib/agent/client";
import { GET } from "@/app/api/agent/session/route";

describe("GET /api/agent/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires a Web user session", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
  });

  it("signs an Agent session token and proxies the protected Agent session", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-agent-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    const getSession = vi.fn().mockResolvedValue({
      requestId: "req_agent",
      data: {
        status: "ok",
        subject: "user_123",
        resumeId: null,
        scope: "agent:session",
        expiresAt: "2026-06-08T08:02:00.000Z",
        requestId: "req_agent",
      },
    });
    (createAgentClient as unknown as Mock).mockReturnValue({ getSession });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(signAgentToken).toHaveBeenCalledWith({
      userId: "user_123",
      scope: "agent:session",
    });
    expect(getSession).toHaveBeenCalledWith({ token: "signed-agent-token" });
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      tokenExpiresAt: "2026-06-08T08:02:00.000Z",
      agent: {
        status: "ok",
        subject: "user_123",
        resumeId: null,
        scope: "agent:session",
        expiresAt: "2026-06-08T08:02:00.000Z",
        requestId: "req_agent",
      },
      requestId: "req_agent",
    });
  });

  it("includes safe Web runtime diagnostics on explicit debug Agent failures", async () => {
    vi.stubEnv("AGENT_JWT_SECRET", ' export AGENT_JWT_SECRET="test-agent-secret" \n');
    vi.stubEnv("AGENT_JWT_ISSUER", "intro-builder-web");
    vi.stubEnv("AGENT_JWT_AUDIENCE", "intro-builder-agent");
    vi.stubEnv("AGENT_BASE_URL", "https://api.rory-x.me/intro-builder/agent");
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-agent-token",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    const getSession = vi.fn().mockRejectedValue(
      new AgentClientError("Invalid or expired bearer token", {
        statusCode: 401,
        error: "unauthorized",
        requestId: "req_agent_debug",
      }),
    );
    (createAgentClient as unknown as Mock).mockReturnValue({ getSession });

    const response = await GET(
      new Request("https://intro.test/api/agent/session?debug=1"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Agent 服务暂不可用",
      code: "unauthorized",
      requestId: "req_agent_debug",
      debug: {
        agentBaseUrl: "https://api.rory-x.me/intro-builder/agent",
        jwtAudience: "intro-builder-agent",
        jwtIssuer: "intro-builder-web",
        jwtSecret: {
          isSet: true,
          rawLength: 46,
          normalizedLength: 17,
          normalizedSha256_12: createHash("sha256")
            .update("test-agent-secret")
            .digest("hex")
            .slice(0, 12),
        },
      },
    });
  });
});
