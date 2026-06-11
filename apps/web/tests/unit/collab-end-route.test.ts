import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  selectLimit: vi.fn(),
  updateWhere: vi.fn(),
  updateSet: vi.fn(),
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
    update: vi.fn(() => ({ set: mocks.updateSet })),
  },
}));

import { POST } from "@/app/api/collab/end/route";

describe("POST /api/collab/end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  });

  it("requires a signed-in owner", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await POST(jsonRequest({ sessionId: "collab_1" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("requires a session id", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });

    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "缺少 sessionId" });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("returns 404 when the session does not belong to the owner", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });
    mocks.selectLimit.mockResolvedValue([]);

    const response = await POST(jsonRequest({ sessionId: "collab_1" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "协作会话不存在" });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("marks an owned non-expired session as ended", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });
    mocks.selectLimit.mockResolvedValue([{
      id: "collab_1",
      ownerId: "owner_1",
      status: "active",
      expiresAt: new Date(Date.now() + 60_000),
    }]);
    mocks.updateWhere.mockResolvedValue(undefined);

    const response = await POST(jsonRequest({ sessionId: "collab_1" }));

    expect(response.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith({ status: "ended" });
    await expect(response.json()).resolves.toEqual({ status: "ended" });
  });

  it("does not reactivate expired sessions", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner_1" } });
    mocks.selectLimit.mockResolvedValue([{
      id: "collab_1",
      ownerId: "owner_1",
      status: "active",
      expiresAt: new Date(Date.now() - 60_000),
    }]);

    const response = await POST(jsonRequest({ sessionId: "collab_1" }));

    expect(response.status).toBe(410);
    expect(mocks.updateSet).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "会话已过期", status: "expired" });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://intro.test/api/collab/end", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
