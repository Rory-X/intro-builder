import { eq } from "drizzle-orm";

import type { AgentSessionSnapshot } from "../agent-messages.js";
import { db as defaultDb, type AgentDb } from "./index.js";
import { agentSessions, agentSessionEvents } from "./schema.js";

export type AgentSessionRow = {
  id: string;
  userId: string;
  resumeId: string | null;
  mode: AgentSessionSnapshot["mode"];
  status: AgentSessionSnapshot["status"];
  title: string;
  stateJson: AgentSessionSnapshot;
  lastResumeContentHash: string | null;
};

export type AgentSessionEventRow = {
  sessionId: string;
  runId: string;
  sequence: number;
  type: string;
  payloadJson: Record<string, unknown>;
};

/**
 * Narrow persistence port for agent sessions. Kept deliberately small so the
 * session store logic is unit-testable against an in-memory fake, while the
 * Drizzle implementation stays a thin adapter over Postgres.
 */
export type AgentSessionRepository = {
  getSnapshot(sessionId: string): Promise<AgentSessionSnapshot | null>;
  upsertSession(row: AgentSessionRow): Promise<void>;
  appendEvents(rows: AgentSessionEventRow[]): Promise<void>;
};

export function createDrizzleAgentSessionRepository(
  database: AgentDb = defaultDb,
): AgentSessionRepository {
  return {
    async getSnapshot(sessionId) {
      const rows = await database
        .select({ stateJson: agentSessions.stateJson })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .limit(1);
      return rows[0]?.stateJson ?? null;
    },

    async upsertSession(row) {
      await database
        .insert(agentSessions)
        .values({
          id: row.id,
          userId: row.userId,
          resumeId: row.resumeId,
          mode: row.mode,
          status: row.status,
          title: row.title,
          stateJson: row.stateJson,
          lastResumeContentHash: row.lastResumeContentHash,
        })
        .onConflictDoUpdate({
          target: agentSessions.id,
          set: {
            status: row.status,
            title: row.title,
            stateJson: row.stateJson,
            lastResumeContentHash: row.lastResumeContentHash,
            updatedAt: new Date(),
          },
        });
    },

    async appendEvents(rows) {
      if (rows.length === 0) return;
      await database
        .insert(agentSessionEvents)
        .values(rows)
        .onConflictDoNothing({
          target: [
            agentSessionEvents.sessionId,
            agentSessionEvents.runId,
            agentSessionEvents.sequence,
          ],
        });
    },
  };
}
