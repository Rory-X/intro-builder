import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  updateSet: vi.fn(),
}));

vi.mock("jose", () => ({
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("party-token"),
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
    update: vi.fn(() => ({ set: mocks.updateSet })),
  },
}));

import { POST } from "@/app/api/collab/join/route";

describe("POST /api/collab/join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COLLAB_JWT_SECRET = "test-secret";
  });

  it("rejects ended sessions before issuing a token", async () => {
    mocks.selectLimit.mockResolvedValue([{
      id: "collab_1",
      resumeId: "resume_1",
      inviteToken: "invite_1",
      mode: "edit",
      status: "ended",
      expiresAt: new Date(Date.now() + 60_000),
    }]);

    const response = await POST(jsonRequest({ inviteToken: "invite_1", mentorName: "导师" }));

    expect(response.status).toBe(410);
    expect(mocks.updateSet).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "协作已结束，请联系对方重新邀请",
      status: "ended",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://intro.test/api/collab/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
