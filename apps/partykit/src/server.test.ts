import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import type * as Party from "partykit/server";

const onYjsConnect = vi.hoisted(() => vi.fn());

vi.mock("y-partykit", () => ({
  onConnect: onYjsConnect,
}));

import CollabServer from "./server";

const SECRET = "test-collab-secret-with-enough-entropy";
const ROOM_ID = "resume-resume_123-session_456";

async function createToken() {
  return new SignJWT({
    resumeId: "resume_123",
    sessionId: "session_456",
    userId: "user_789",
    displayName: "测试用户",
    role: "owner",
    mode: "edit",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

function createHarness({
  roomId = ROOM_ID,
  secret = SECRET,
}: {
  roomId?: string;
  secret?: string | null;
} = {}) {
  const send = vi.fn();
  const close = vi.fn();
  const connection = {
    id: "connection_1",
    send,
    close,
  } as unknown as Party.Connection;
  const room = {
    id: roomId,
    env: secret === null ? {} : { COLLAB_JWT_SECRET: secret },
    getConnections: () => [connection],
  } as unknown as Party.Room;

  return {
    close,
    connection,
    room,
    server: new CollabServer(room),
  };
}

function connectionContext(token?: string) {
  const url = new URL("https://example.test/parties/intro-collab/room");
  if (token) url.searchParams.set("token", token);
  return {
    request: new Request(url),
  } as unknown as Party.ConnectionContext;
}

describe("CollabServer.onConnect", () => {
  beforeEach(() => {
    onYjsConnect.mockReset();
    onYjsConnect.mockResolvedValue(undefined);
  });

  it("closes a connection with no token before Yjs starts", async () => {
    const { close, connection, server } = createHarness();

    await server.onConnect(connection, connectionContext());

    expect(close).toHaveBeenCalledWith(4401, "Unauthorized");
    expect(onYjsConnect).not.toHaveBeenCalled();
  });

  it("closes a connection when the worker secret is missing", async () => {
    const token = await createToken();
    const { close, connection, server } = createHarness({ secret: null });

    await server.onConnect(connection, connectionContext(token));

    expect(close).toHaveBeenCalledWith(4401, "Unauthorized");
    expect(onYjsConnect).not.toHaveBeenCalled();
  });

  it("closes a token issued for a different room before Yjs starts", async () => {
    const token = await createToken();
    const { close, connection, server } = createHarness({ roomId: "resume-other-session" });

    await server.onConnect(connection, connectionContext(token));

    expect(close).toHaveBeenCalledWith(4401, "Unauthorized");
    expect(onYjsConnect).not.toHaveBeenCalled();
  });

  it("hands a valid room-bound connection to Yjs", async () => {
    const token = await createToken();
    const { close, connection, room, server } = createHarness();
    const context = connectionContext(token);

    await server.onConnect(connection, context);

    expect(close).not.toHaveBeenCalled();
    expect(onYjsConnect).toHaveBeenCalledWith(connection, room, {
      persist: { mode: "snapshot" },
    });
  });
});
