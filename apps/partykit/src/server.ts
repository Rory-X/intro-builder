import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";
import { verifyCollabToken } from "./utils/auth";

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
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");
    const secret = this.room.env.COLLAB_JWT_SECRET;
    if (!token || typeof secret !== "string" || secret.length === 0) {
      conn.close(4401, "Unauthorized");
      return;
    }

    let payload;
    try {
      payload = await verifyCollabToken(token, secret, this.room.id);
    } catch {
      conn.close(4401, "Unauthorized");
      return;
    }

    const meta: ConnectionMeta = {
      userId: payload.userId,
      displayName: payload.displayName,
      role: payload.role,
      color:
        payload.role === "owner"
          ? OWNER_COLOR
          : MENTOR_COLORS[this.connections.size % MENTOR_COLORS.length],
    };

    this.connections.set(conn.id, meta);
    this.broadcastPresence();

    // Hand off to y-partykit for Y.js document sync
    return onConnect(conn, this.room, {
      persist: { mode: "snapshot" },
    });
  }

  onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    // Only handle text (JSON) messages; binary messages are Y.js sync
    if (typeof message !== "string") return;

    try {
      const data = JSON.parse(message);

      // Relay session-end to all OTHER connections
      if (data.type === "session-end") {
        const relay = JSON.stringify({ type: "session-ended", reason: "owner-ended" });
        for (const conn of this.room.getConnections()) {
          if (conn.id !== sender.id) {
            conn.send(relay);
          }
        }
        return;
      }

      // Relay WebRTC voice signaling messages to all OTHER connections
      const voiceTypes = [
        "voice-ring", "voice-accept", "voice-reject", "voice-cancel",
        "voice-offer", "voice-answer", "voice-ice-candidate", "voice-hangup",
      ];
      if (voiceTypes.includes(data.type)) {
        const meta = this.connections.get(sender.id);
        const relay = JSON.stringify({ ...data, from: sender.id, callerName: meta?.displayName });
        for (const conn of this.room.getConnections()) {
          if (conn.id !== sender.id) {
            conn.send(relay);
          }
        }
      }
    } catch {
      // Not JSON — ignore (could be y-partykit internal text messages)
    }
  }

  onClose(conn: Party.Connection) {
    const meta = this.connections.get(conn.id);
    this.connections.delete(conn.id);
    this.broadcastPresence();

    // When the owner disconnects, notify remaining connections so mentor can verify session state
    if (meta?.role === "owner") {
      const msg = JSON.stringify({ type: "owner-disconnected" });
      for (const c of this.room.getConnections()) {
        c.send(msg);
      }
    }
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
