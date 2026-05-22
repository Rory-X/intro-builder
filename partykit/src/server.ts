import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";
import { verifyCollabToken, type CollabTokenPayload } from "./utils/auth";

type ConnectionMeta = {
  userId: string;
  displayName: string;
  role: "owner" | "mentor";
  color: string;
};

const MENTOR_COLORS = ["#8B5CF6", "#EC4899", "#F97316", "#06B6D4"];
const OWNER_COLOR = "#2563EB";

export default class CollabServer implements Party.Server {
  constructor(readonly room: Party.Room) {}

  private connections = new Map<string, ConnectionMeta>();

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    // Extract token from URL params
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      conn.close(4001, "Missing auth token");
      return;
    }

    // Verify JWT
    const secret = this.room.env.COLLAB_JWT_SECRET as string;
    if (!secret) {
      conn.close(4000, "Server misconfigured");
      return;
    }

    let payload: CollabTokenPayload;
    try {
      payload = await verifyCollabToken(token, secret);
    } catch {
      conn.close(4002, "Invalid or expired token");
      return;
    }

    // Verify room ID matches the token
    const expectedRoom = `resume:${payload.resumeId}:${payload.sessionId}`;
    if (this.room.id !== expectedRoom) {
      conn.close(4003, "Room mismatch");
      return;
    }

    // Store connection metadata
    const meta: ConnectionMeta = {
      userId: payload.userId,
      displayName: payload.displayName,
      role: payload.role,
      color: payload.role === "owner" ? OWNER_COLOR : MENTOR_COLORS[this.connections.size % MENTOR_COLORS.length],
    };
    this.connections.set(conn.id, meta);

    // Broadcast presence
    this.broadcastPresence();

    // Hand off to y-partykit for Y.js document sync
    return onConnect(conn, this.room, {
      persist: { mode: "snapshot" },
    });
  }

  onClose(conn: Party.Connection) {
    this.connections.delete(conn.id);
    this.broadcastPresence();
  }

  private broadcastPresence() {
    const users = Array.from(this.connections.values());
    const msg = JSON.stringify({ type: "presence", users });
    for (const c of this.room.getConnections()) {
      c.send(msg);
    }
  }

  // HTTP endpoint for health check
  async onRequest(req: Party.Request) {
    if (req.method === "GET") {
      return new Response(JSON.stringify({
        room: this.room.id,
        connections: this.connections.size,
      }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("Not found", { status: 404 });
  }
}

CollabServer satisfies Party.Worker;
