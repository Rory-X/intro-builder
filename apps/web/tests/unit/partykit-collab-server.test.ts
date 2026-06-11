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
});

function fakeConnection(id: string) {
  return {
    id,
    send: vi.fn(),
  };
}
