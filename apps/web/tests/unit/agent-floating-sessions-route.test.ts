import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({ currentUserId: vi.fn() }));
vi.mock("@/lib/agent/floating-chat-session-store", () => ({
  createFloatingChatSession: vi.fn(),
  deleteFloatingChatSession: vi.fn(),
  getFloatingChatSession: vi.fn(),
  listFloatingChatMessages: vi.fn(),
  listFloatingChatSessions: vi.fn(),
}));

import {
  GET as getSessions,
  POST as createSession,
} from "@/app/api/agent/floating/sessions/route";
import {
  DELETE as deleteSession,
  GET as getSession,
} from "@/app/api/agent/floating/sessions/[sessionId]/route";
import { currentUserId } from "@/lib/auth-helpers";
import {
  createFloatingChatSession,
  deleteFloatingChatSession,
  getFloatingChatSession,
  listFloatingChatMessages,
  listFloatingChatSessions,
} from "@/lib/agent/floating-chat-session-store";

describe("floating agent session routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists sessions for the current resume", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (listFloatingChatSessions as unknown as Mock).mockResolvedValue([
      { id: "session_1", title: "优化经历", updatedAt: "2026-06-18T08:00:00.000Z" },
    ]);

    const response = await getSessions(
      new Request("https://intro.test/api/agent/floating/sessions?resumeId=resume_1"),
    );

    expect(response.status).toBe(200);
    expect(listFloatingChatSessions).toHaveBeenCalledWith({
      userId: "user_123",
      resumeId: "resume_1",
    });
    await expect(response.json()).resolves.toEqual({
      sessions: [
        { id: "session_1", title: "优化经历", updatedAt: "2026-06-18T08:00:00.000Z" },
      ],
    });
  });

  it("creates a new session for the current resume", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (createFloatingChatSession as unknown as Mock).mockResolvedValue({
      id: "session_2",
      title: "新对话",
      updatedAt: "2026-06-18T08:01:00.000Z",
    });

    const response = await createSession(jsonRequest({ resumeId: "resume_1" }));

    expect(response.status).toBe(200);
    expect(createFloatingChatSession).toHaveBeenCalledWith({
      userId: "user_123",
      resumeId: "resume_1",
    });
    await expect(response.json()).resolves.toEqual({
      session: {
        id: "session_2",
        title: "新对话",
        updatedAt: "2026-06-18T08:01:00.000Z",
      },
    });
  });

  it("loads one session with its messages", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (getFloatingChatSession as unknown as Mock).mockResolvedValue({
      id: "session_1",
      title: "优化经历",
      resumeId: "resume_1",
      updatedAt: new Date("2026-06-18T08:00:00.000Z"),
    });
    (listFloatingChatMessages as unknown as Mock).mockResolvedValue({
      messages: [{ id: "msg_1", role: "user", content: "优化经历", toolCalls: [], operations: [], createdAt: "2026-06-18T08:00:00.000Z" }],
      hasMore: false,
      nextCursor: null,
    });

    const response = await getSession(
      new Request("https://intro.test/api/agent/floating/sessions/session_1"),
      routeContext("session_1"),
    );

    expect(response.status).toBe(200);
    expect(getFloatingChatSession).toHaveBeenCalledWith({
      sessionId: "session_1",
      userId: "user_123",
    });
    expect(listFloatingChatMessages).toHaveBeenCalledWith({
      sessionId: "session_1",
      before: null,
      limit: 30,
    });
    await expect(response.json()).resolves.toEqual({
      session: {
        id: "session_1",
        title: "优化经历",
        updatedAt: "2026-06-18T08:00:00.000Z",
      },
      messages: [
        { id: "msg_1", role: "user", content: "优化经历", toolCalls: [], operations: [], createdAt: "2026-06-18T08:00:00.000Z" },
      ],
      hasMore: false,
      nextCursor: null,
    });
  });

  it("deletes an owned session", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (deleteFloatingChatSession as unknown as Mock).mockResolvedValue(true);

    const response = await deleteSession(
      new Request("https://intro.test/api/agent/floating/sessions/session_1"),
      routeContext("session_1"),
    );

    expect(response.status).toBe(200);
    expect(deleteFloatingChatSession).toHaveBeenCalledWith({
      sessionId: "session_1",
      userId: "user_123",
    });
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://intro.test/api/agent/floating/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}
