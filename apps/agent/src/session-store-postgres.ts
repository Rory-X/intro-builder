import type { AgentSessionStore } from "./session-store.js";
import type { AgentSessionRepository } from "./db/agent-session-repository.js";

/**
 * Postgres-backed {@link AgentSessionStore}. Mirrors the Redis store's contract
 * (loadSnapshot / appendEvents) but persists the session snapshot and run events
 * to the `agent_session` / `agent_session_event` tables via a narrow repository
 * port — so the durable session survives restarts and is the source of truth
 * the user "continues" and the preview is read from.
 */
export function createPostgresAgentSessionStore(
  repo: AgentSessionRepository,
): AgentSessionStore {
  return {
    async loadSnapshot({ context }) {
      return repo.getSnapshot(context.sessionId);
    },

    async appendEvents({ session, context, events, snapshot }) {
      await repo.upsertSession({
        id: context.sessionId,
        userId: session.userId,
        resumeId: context.resumeId,
        mode: snapshot.mode,
        status: snapshot.status,
        title: context.resumeTitle,
        stateJson: snapshot,
        lastResumeContentHash: snapshot.lastResumeContentHash,
      });

      if (events.length > 0) {
        await repo.appendEvents(
          events.map((event) => ({
            sessionId: context.sessionId,
            runId: event.runId,
            sequence: event.sequence,
            type: event.type,
            payloadJson: event.payload as unknown as Record<string, unknown>,
          })),
        );
      }
    },
  };
}
