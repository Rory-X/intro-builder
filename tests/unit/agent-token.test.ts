// @vitest-environment node

import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { signAgentToken } from "@/lib/agent/token";

const NOW = new Date("2026-06-08T08:00:00.000Z");

describe("Web Agent token signer", () => {
  it("signs a short-lived Agent JWT with the required claims", async () => {
    const result = await signAgentToken({
      userId: "user_123",
      resumeId: "resume_abc",
      scope: "agent:session",
      jwtSecret: "test-agent-secret",
      now: NOW,
      createJti: () => "jti_web_valid",
    });

    const { payload, protectedHeader } = await jwtVerify(
      result.token,
      new TextEncoder().encode("test-agent-secret"),
      {
        issuer: "intro-builder-web",
        audience: "intro-builder-agent",
        currentDate: NOW,
      },
    );

    expect(protectedHeader.alg).toBe("HS256");
    expect(result).toMatchObject({
      jti: "jti_web_valid",
      scope: "agent:session",
      expiresAt: new Date("2026-06-08T08:02:00.000Z"),
    });
    expect(payload).toMatchObject({
      iss: "intro-builder-web",
      aud: "intro-builder-agent",
      sub: "user_123",
      resumeId: "resume_abc",
      scope: "agent:session",
      jti: "jti_web_valid",
      iat: 1780905600,
      exp: 1780905720,
    });
  });

  it("allows a shorter ttl but rejects long-lived tokens", async () => {
    const short = await signAgentToken({
      userId: "user_123",
      scope: "agent:session",
      ttlSeconds: 60,
      jwtSecret: "test-agent-secret",
      now: NOW,
      createJti: () => "jti_short",
    });

    expect(short.expiresAt).toEqual(new Date("2026-06-08T08:01:00.000Z"));
    await expect(
      signAgentToken({
        userId: "user_123",
        scope: "agent:session",
        ttlSeconds: 181,
        jwtSecret: "test-agent-secret",
        now: NOW,
        createJti: () => "jti_too_long",
      }),
    ).rejects.toThrow(/Agent JWT ttl must be between 1 and 180 seconds/);
  });

  it("requires a signing secret", async () => {
    await expect(
      signAgentToken({
        userId: "user_123",
        scope: "agent:session",
        jwtSecret: "",
        now: NOW,
      }),
    ).rejects.toThrow(/AGENT_JWT_SECRET is required/);
  });
});
