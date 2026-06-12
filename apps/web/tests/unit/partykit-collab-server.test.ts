import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("y-partykit", () => ({
  onConnect: vi.fn(),
}));

import CollabServer from "../../../partykit/src/server";

describe("CollabServer session ending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("relays session-end as session-ended to other connections", () => {
    const owner = fakeConnection("owner");
    const mentor = fakeConnection("mentor");
    const room = {
      id: "room_1",
      getConnections: () => [owner, mentor],
    };
    const server = new CollabServer(room as never);

    server.onMessage(JSON.stringify({ type: "session-end" }), owner as never);

    expect(owner.send).not.toHaveBeenCalled();
    expect(mentor.send).toHaveBeenCalledWith(JSON.stringify({
      type: "session-ended",
      reason: "owner-ended",
    }));
  });

  it("broadcasts owner-disconnected when an owner connection closes", () => {
    const owner = fakeConnection("owner");
    const mentor = fakeConnection("mentor");
    const room = {
      id: "room_1",
      getConnections: () => [mentor],
    };
    const server = new CollabServer(room as never);

    // Simulate owner having connected (register in connections map via onConnect metadata)
    // Directly set the internal state since onConnect requires full Party.Connection context
    (server as unknown as { connections: Map<string, { userId: string; displayName: string; role: string; color: string }> })
      .connections.set("owner", { userId: "owner_1", displayName: "作者", role: "owner", color: "#2563EB" });

    server.onClose(owner as never);

    expect(mentor.send).toHaveBeenCalledWith(JSON.stringify({ type: "owner-disconnected" }));
  });

  it("does not broadcast owner-disconnected when a mentor disconnects", () => {
    const mentor1 = fakeConnection("mentor1");
    const mentor2 = fakeConnection("mentor2");
    const room = {
      id: "room_1",
      getConnections: () => [mentor2],
    };
    const server = new CollabServer(room as never);

    (server as unknown as { connections: Map<string, { userId: string; displayName: string; role: string; color: string }> })
      .connections.set("mentor1", { userId: "m1", displayName: "导师", role: "mentor", color: "#8B5CF6" });

    server.onClose(mentor1 as never);

    // Should only get presence update, not owner-disconnected
    const calls = mentor2.send.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
    expect(calls.every((c: { type: string }) => c.type !== "owner-disconnected")).toBe(true);
  });
});

function fakeConnection(id: string) {
  return {
    id,
    send: vi.fn(),
  };
}
