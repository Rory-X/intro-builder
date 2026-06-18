import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  delete: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    delete: dbMocks.delete,
    update: dbMocks.update,
  },
}));

import {
  deleteFloatingChatSession,
  renameFloatingChatSession,
} from "@/lib/agent/floating-chat-session-store";

describe("floating chat session store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a deleted session when Drizzle returns deleted rows", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "session_1" }]);
    const where = vi.fn().mockReturnValue({ returning });
    dbMocks.delete.mockReturnValue({ where });

    const result = await deleteFloatingChatSession({
      sessionId: "session_1",
      userId: "user_123",
    });

    expect(result).toBe(true);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it("reports a missing session when delete returns no rows", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    dbMocks.delete.mockReturnValue({ where });

    const result = await deleteFloatingChatSession({
      sessionId: "session_missing",
      userId: "user_123",
    });

    expect(result).toBe(false);
  });

  it("reports a renamed session when Drizzle returns updated rows", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "session_1" }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    dbMocks.update.mockReturnValue({ set });

    const result = await renameFloatingChatSession({
      sessionId: "session_1",
      userId: "user_123",
      title: "优化经历",
    });

    expect(result).toBe(true);
    expect(returning).toHaveBeenCalledTimes(1);
  });
});
