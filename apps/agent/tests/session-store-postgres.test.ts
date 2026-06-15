import { describe, expect, it } from "vitest";
import type { BaseEvent } from "@ag-ui/core";

import type { AuthenticatedAgentSession } from "../src/auth.js";
import type { AgentRunSessionContext } from "../src/agent-messages.js";
import { createInitialAgentSessionSnapshot } from "../src/session-store.js";
import { createPostgresAgentSessionStore } from "../src/session-store-postgres.js";
import type {
  AgentSessionRepository,
  AgentSessionRow,
  AgentSessionEventRow,
} from "../src/db/agent-session-repository.js";

function fakeRepo() {
  const sessions = new Map<string, AgentSessionRow>();
  const events: AgentSessionEventRow[] = [];
  const repo: AgentSessionRepository = {
    async getSnapshot(id) {
      return sessions.get(id)?.stateJson ?? null;
    },
    async upsertSession(row) {
      sessions.set(row.id, row);
    },
    async appendEvents(rows) {
      events.push(...rows);
    },
  };
  return { repo, sessions, events };
}

const context: AgentRunSessionContext = {
  sessionId: "agent_session_r1",
  threadId: "r1",
  resumeId: "r1",
  mode: "optimize_existing",
  workflowId: null,
  resumeTitle: "我的简历",
};

const session: AuthenticatedAgentSession = {
  userId: "u1",
  resumeId: "r1",
  scope: "agent:chat",
  jti: "jti-1",
  expiresAt: new Date("2026-06-15T01:00:00.000Z"),
};

const runStarted = { type: "RUN_STARTED" } as unknown as BaseEvent;

describe("createPostgresAgentSessionStore", () => {
  it("returns null when no session row exists", async () => {
    const { repo } = fakeRepo();
    const store = createPostgresAgentSessionStore(repo);
    expect(await store.loadSnapshot({ session, context })).toBeNull();
  });

  it("upserts the session row and appends events on appendEvents", async () => {
    const { repo, sessions, events } = fakeRepo();
    const store = createPostgresAgentSessionStore(repo);
    const snapshot = createInitialAgentSessionSnapshot({
      context,
      userId: "u1",
      now: "2026-06-15T00:00:00.000Z",
    });

    await store.appendEvents({
      session,
      context,
      snapshot,
      events: [
        { runId: "run1", sequence: 1, type: "RUN_STARTED", payload: runStarted },
      ],
    });

    const row = sessions.get("agent_session_r1");
    expect(row?.userId).toBe("u1");
    expect(row?.resumeId).toBe("r1");
    expect(row?.title).toBe("我的简历");
    expect(row?.stateJson.sessionId).toBe("agent_session_r1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sessionId: "agent_session_r1",
      runId: "run1",
      sequence: 1,
      type: "RUN_STARTED",
    });
  });

  it("loads back the snapshot it persisted", async () => {
    const { repo } = fakeRepo();
    const store = createPostgresAgentSessionStore(repo);
    const snapshot = createInitialAgentSessionSnapshot({
      context,
      userId: "u1",
      now: "2026-06-15T00:00:00.000Z",
    });

    await store.appendEvents({ session, context, snapshot, events: [] });

    const loaded = await store.loadSnapshot({ session, context });
    expect(loaded).toMatchObject({ sessionId: "agent_session_r1", resumeId: "r1" });
  });
});
