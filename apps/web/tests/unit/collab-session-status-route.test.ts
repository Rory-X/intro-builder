import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  selectLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
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

import { GET } from "@/app/api/collab/session-status/route";

describe("GET /api/collab/session-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ended as a terminal session status", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });
    mocks.selectLimit.mockResolvedValue([{
      id: "collab_1",
      ownerId: "owner_1",
      status: "ended",
      mentorName: "导师",
      expiresAt: new Date(Date.now() + 60_000),
    }]);

    const response = await GET(new Request("https://intro.test/api/collab/session-status?sessionId=collab_1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ended",
      mentorName: "导师",
    });
  });
});
