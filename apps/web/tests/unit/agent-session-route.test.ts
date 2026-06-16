import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({ currentUserId: vi.fn() }));
vi.mock("@/lib/agent/token", () => ({ signAgentToken: vi.fn() }));
// We do NOT mock the fetch call to the agent’s /v1/agent/session — tests
// intercept global fetch instead so we can assert on the upstream request.

import { currentUserId } from "@/lib/auth-helpers";
import { signAgentToken } from "@/lib/agent/token";
import { POST } from "@/app/api/agent/session/route";

describe("POST /api/agent/session (minimal BFF)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 401 when the user is not signed in", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue(null);

    const response = await POST(
      new Request("https://intro.test/api/agent/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeId: "r1" }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
  });

  it("returns 404 when the resume does not belong to the user", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_1");

    const { db } = await import("@/db");
    vi.spyOn(db.query.resumes, "findFirst").mockResolvedValue(null as never);

    const response = await POST(
      new Request("https://intro.test/api/agent/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeId: "r999" }),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("signs a token, calls agent /v1/agent/session, and returns sessionId + token + agentBaseUrl", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_2");
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-jwt",
      expiresAt: new Date("2026-06-09T10:00:00.000Z"),
    });

    const { db } = await import("@/db");
    vi.spyOn(db.query.resumes, "findFirst").mockResolvedValue({
      id: "r1",
      userId: "user_2",
    } as never);

    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sessionId: "session_r1", mode: "optimize_existing" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(
      new Request("https://intro.test/api/agent/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeId: "r1", mode: "optimize_existing" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/agent/session"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer signed-jwt",
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      sessionId: "session_r1",
      token: "signed-jwt",
      agentBaseUrl: expect.any(String),
      tokenExpiresAt: "2026-06-09T10:00:00.000Z",
    });
  });

  it("returns 502 when the upstream agent session creation fails", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_3");
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-jwt",
      expiresAt: new Date(),
    });

    const { db } = await import("@/db");
    vi.spyOn(db.query.resumes, "findFirst").mockResolvedValue({
      id: "r1",
      userId: "user_3",
    } as never);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "internal_error" }), { status: 500 }),
      ),
    );

    const response = await POST(
      new Request("https://intro.test/api/agent/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeId: "r1" }),
      }),
    );

    expect(response.status).toBe(500);
  });

  it("handles null resumeId (create-from-zero mode)", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_4");
    (signAgentToken as unknown as Mock).mockResolvedValue({
      token: "signed-jwt",
      expiresAt: new Date(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ sessionId: "session_create_from_zero" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const response = await POST(
      new Request("https://intro.test/api/agent/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: "session_create_from_zero",
      token: "signed-jwt",
      agentBaseUrl: expect.any(String),
      tokenExpiresAt: expect.any(String),
    });
  });
});
