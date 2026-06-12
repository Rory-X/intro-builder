import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  selectLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("jose", () => ({
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("owner-party-token"),
  })),
}));
vi.mock("@/lib/db-retry", () => ({
  withDbRetry: (_label: string, fn: () => unknown) => fn(),
}));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectLimit })),
      })),
    })),
  },
}));

import { POST } from "@/app/api/collab/owner-token/route";

describe("POST /api/collab/owner-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COLLAB_JWT_SECRET = "test-secret";
  });

  it("rejects ended sessions before issuing owner tokens", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1", name: "作者" } });
    mocks.selectLimit.mockResolvedValue([{
      id: "collab_1",
      resumeId: "resume_1",
      ownerId: "owner_1",
      mode: "edit",
      status: "ended",
      expiresAt: new Date(Date.now() + 60_000),
    }]);

    const response = await POST(jsonRequest({ sessionId: "collab_1" }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "协作已结束",
      status: "ended",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://intro.test/api/collab/owner-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
