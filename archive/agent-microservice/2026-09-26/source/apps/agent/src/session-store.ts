import { createHash } from "node:crypto";

import { EventType, type BaseEvent } from "@ag-ui/core";

import type { AuthenticatedAgentSession } from "./auth.js";
import type {
  AgentMessageRequest,
  AgentRunSessionContext,
  AgentSessionInterrupt,
  AgentSessionSnapshot,
} from "./agent-messages.js";
import type { RedisConnection } from "./redis.js";
import type { AgentContextStatusSnapshot } from "./workflows/context-status.js";
import type { AgentResumeWorkspaceSnapshot } from "./workflows/resume-workspace.js";

export type AgentSessionEventRecord = {
  runId: string;
  sequence: number;
  type: string;
  payload: BaseEvent;
};

export type LoadAgentSessionSnapshotInput = {
  session: AuthenticatedAgentSession;
  context: AgentRunSessionContext;
};

export type AppendAgentSessionEventsInput = {
  session: AuthenticatedAgentSession;
  context: AgentRunSessionContext;
  events: AgentSessionEventRecord[];
  snapshot: AgentSessionSnapshot;
};

export type AgentSessionStore = {
  loadSnapshot: (
    input: LoadAgentSessionSnapshotInput,
  ) => Promise<AgentSessionSnapshot | null>;
  appendEvents: (input: AppendAgentSessionEventsInput) => Promise<void>;
};

export type AgentSessionRecorder = {
  record: (event: BaseEvent) => void;
  close: () => Promise<void>;
};

type AgentSessionRedis = Pick<RedisConnection, "expire" | "get" | "set" | "rPush">;

const EVENT_BATCH_SIZE = 25;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function createRedisAgentSessionStore(
  redis: AgentSessionRedis,
): AgentSessionStore {
  return {
    async loadSnapshot({ context }) {
      const raw = await redis.get(snapshotKey(context.sessionId));
      if (!raw) return null;

      try {
        const parsed = JSON.parse(raw);
        if (!isAgentSessionSnapshot(parsed)) return null;
        if (parsed.sessionId !== context.sessionId) return null;
        if (parsed.resumeId !== context.resumeId) return null;
        return parsed;
      } catch {
        return null;
      }
    },

    async appendEvents({ context, events, snapshot }) {
      if (events.length > 0) {
        await redis.rPush(
          eventsKey(context.sessionId),
          events.map((event) => JSON.stringify(event)),
        );
        await redis.expire(eventsKey(context.sessionId), SESSION_TTL_SECONDS);
      }
      await redis.set(snapshotKey(context.sessionId), JSON.stringify(snapshot), {
        EX: SESSION_TTL_SECONDS,
      });
    },
  };
}

export function createAgentSessionRecorder({
  store,
  session,
  context,
  runId,
  now,
  initialSnapshot,
  onError,
}: {
  store: AgentSessionStore;
  session: AuthenticatedAgentSession;
  context: AgentRunSessionContext;
  runId: string;
  now: () => Date;
  initialSnapshot: AgentSessionSnapshot | null;
  onError?: (error: unknown) => void;
}): AgentSessionRecorder {
  let snapshot =
    initialSnapshot ??
    createInitialAgentSessionSnapshot({
      context,
      userId: session.userId,
      now: now().toISOString(),
    });
  let sequence = 0;
  let batch: AgentSessionEventRecord[] = [];
  let pendingFlush = Promise.resolve();

  const flush = () => {
    if (batch.length === 0) return;
    const events = batch;
    const flushSnapshot = snapshot;
    batch = [];
    pendingFlush = pendingFlush
      .then(() =>
        store.appendEvents({
          session,
          context,
          events,
          snapshot: flushSnapshot,
        }),
      )
      .catch((error) => {
        onError?.(error);
      });
  };

  return {
    record(event) {
      sequence += 1;
      snapshot = reduceAgentSessionSnapshot(snapshot, event);
      batch.push({
        runId,
        sequence,
        type: event.type,
        payload: event,
      });
      if (batch.length >= EVENT_BATCH_SIZE) flush();
    },
    async close() {
      flush();
      await pendingFlush;
    },
  };
}

export function createInitialAgentSessionSnapshot({
  context,
  userId,
  now,
}: {
  context: AgentRunSessionContext;
  userId: string;
  now: string;
}): AgentSessionSnapshot {
  return {
    sessionId: context.sessionId,
    threadId: context.threadId,
    resumeId: context.resumeId,
    userIdHash: hashUserId(userId),
    mode: context.mode,
    status: "active",
    workflow: {
      workflowId: context.workflowId,
      nodeId: "intake_goal",
      loopCount: 0,
      completedNodeIds: [],
    },
    workspace: {
      resumeId: context.resumeId,
      mode: context.mode,
      goal: {
        workflowId: context.workflowId,
        resumeTitle: context.resumeTitle,
        targetRole: null,
        locale: "zh-CN",
      },
      facts: [],
      draftResume: null,
      changeSets: [],
      decisions: [],
      qualityReport: null,
      updatedAt: now,
    },
    contextStatus: null,
    pendingInterrupts: [],
    lastResumeContentHash: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function reduceAgentSessionSnapshot(
  snapshot: AgentSessionSnapshot,
  event: BaseEvent,
): AgentSessionSnapshot {
  if (event.type === EventType.STATE_SNAPSHOT) {
    return applyStatePayload(snapshot, (event as { snapshot?: unknown }).snapshot);
  }

  if (event.type === EventType.STATE_DELTA) {
    const delta = (event as { delta?: unknown }).delta;
    if (!Array.isArray(delta)) return snapshot;

    return delta.reduce((current, patch) => {
      if (!isRecord(patch) || patch.op !== "replace") return current;
      if (patch.path === "/contextStatus") {
        return applyContextStatus(current, patch.value);
      }
      if (patch.path === "/workspace") {
        return applyWorkspace(current, patch.value);
      }
      if (patch.path === "/workflow") {
        return applyWorkflow(current, patch.value);
      }
      return current;
    }, snapshot);
  }

  if (event.type === EventType.RUN_FINISHED) {
    const outcome = (event as { outcome?: unknown }).outcome;
    if (isRecord(outcome) && outcome.type === "interrupt") {
      const interrupts = Array.isArray(outcome.interrupts)
        ? outcome.interrupts.map(toSessionInterrupt).filter(isNotNull)
        : [];
      return {
        ...snapshot,
        status: "waiting_user",
        pendingInterrupts: interrupts,
      };
    }
    return {
      ...snapshot,
      status: snapshot.status === "failed" ? "failed" : "active",
      pendingInterrupts: [],
    };
  }

  if (event.type === EventType.RUN_ERROR) {
    return {
      ...snapshot,
      status: "failed",
    };
  }

  return snapshot;
}

export function deriveAgentSessionId({
  resumeId,
  userId,
  threadId,
}: {
  resumeId: string | null;
  userId: string;
  threadId: string;
}): string {
  if (resumeId) {
    return [
      "agent_session",
      sanitizeIdPart(resumeId),
      sanitizeIdPart(threadId),
    ].join("_");
  }
  return [
    "agent_session_create_from_zero",
    hashIdPart(userId),
    sanitizeIdPart(threadId),
  ].join("_");
}

export function agentRequestWithStoreSnapshot(
  request: AgentMessageRequest,
  snapshot: AgentSessionSnapshot | null,
): AgentMessageRequest {
  if (!request.sessionContext) return request;
  const { sessionSnapshot: _ignoredBrowserSnapshot, ...safeRequest } = request;
  void _ignoredBrowserSnapshot;
  return snapshot ? { ...safeRequest, sessionSnapshot: snapshot } : safeRequest;
}

function applyStatePayload(
  snapshot: AgentSessionSnapshot,
  payload: unknown,
): AgentSessionSnapshot {
  if (!isRecord(payload)) return snapshot;

  let next = snapshot;
  if ("contextStatus" in payload) {
    next = applyContextStatus(next, payload.contextStatus);
  }
  if ("workspace" in payload) {
    next = applyWorkspace(next, payload.workspace);
  }
  if ("workflow" in payload) {
    next = applyWorkflow(next, payload.workflow);
  }
  return next;
}

function applyContextStatus(
  snapshot: AgentSessionSnapshot,
  value: unknown,
): AgentSessionSnapshot {
  if (value !== null && !isContextStatus(value)) return snapshot;
  return {
    ...snapshot,
    contextStatus: value,
  };
}

function applyWorkspace(
  snapshot: AgentSessionSnapshot,
  value: unknown,
): AgentSessionSnapshot {
  if (!isWorkspace(value)) return snapshot;
  return {
    ...snapshot,
    resumeId: value.resumeId,
    mode: value.mode,
    workspace: value,
    updatedAt: isDateString(value.updatedAt) ? value.updatedAt : snapshot.updatedAt,
  };
}

function applyWorkflow(
  snapshot: AgentSessionSnapshot,
  value: unknown,
): AgentSessionSnapshot {
  if (!isWorkflowCursor(value)) return snapshot;
  return {
    ...snapshot,
    workflow: value,
  };
}

function toSessionInterrupt(value: unknown): AgentSessionInterrupt | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  if (typeof value.reason !== "string") return null;
  return {
    id: value.id,
    reason: value.reason,
    message: typeof value.message === "string" ? value.message : null,
    toolCallId: typeof value.toolCallId === "string" ? value.toolCallId : null,
    metadata: isRecord(value.metadata) ? value.metadata : null,
  };
}

function snapshotKey(sessionId: string): string {
  return `agent:session:${sessionId}:snapshot`;
}

function eventsKey(sessionId: string): string {
  return `agent:session:${sessionId}:events`;
}

function isContextStatus(value: unknown): value is AgentContextStatusSnapshot {
  return (
    isRecord(value) &&
    typeof value.effectiveInputBudgetTokens === "number" &&
    value.effectiveInputBudgetTokens >= 200_000 &&
    typeof value.usedInputTokens === "number" &&
    typeof value.utilization === "number" &&
    typeof value.status === "string" &&
    Array.isArray(value.sources) &&
    Array.isArray(value.warnings)
  );
}

function isWorkspace(value: unknown): value is AgentResumeWorkspaceSnapshot {
  return (
    isRecord(value) &&
    (value.resumeId === null || typeof value.resumeId === "string") &&
    (value.mode === "optimize_existing" || value.mode === "create_from_zero") &&
    isRecord(value.goal) &&
    Array.isArray(value.facts) &&
    Array.isArray(value.changeSets) &&
    Array.isArray(value.decisions) &&
    typeof value.updatedAt === "string"
  );
}

function isAgentSessionSnapshot(value: unknown): value is AgentSessionSnapshot {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.threadId === "string" &&
    (value.resumeId === null || typeof value.resumeId === "string") &&
    typeof value.userIdHash === "string" &&
    (value.mode === "optimize_existing" || value.mode === "create_from_zero") &&
    isAgentSessionStatus(value.status) &&
    isWorkflowCursor(value.workflow) &&
    isWorkspace(value.workspace) &&
    (value.contextStatus === null || isContextStatus(value.contextStatus)) &&
    Array.isArray(value.pendingInterrupts) &&
    value.pendingInterrupts.every(isSessionInterruptSnapshot) &&
    (value.lastResumeContentHash === null ||
      typeof value.lastResumeContentHash === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isWorkflowCursor(value: unknown): value is AgentSessionSnapshot["workflow"] {
  return (
    isRecord(value) &&
    (value.workflowId === null ||
      value.workflowId === "create-from-zero" ||
      value.workflowId === "resume-diagnose" ||
      value.workflowId === "target-role-match" ||
      value.workflowId === "experience-star" ||
      value.workflowId === "pre-export-check") &&
    typeof value.nodeId === "string" &&
    typeof value.loopCount === "number" &&
    Array.isArray(value.completedNodeIds) &&
    value.completedNodeIds.every((nodeId) => typeof nodeId === "string")
  );
}

function isSessionInterruptSnapshot(
  value: unknown,
): value is AgentSessionInterrupt {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.reason === "string" &&
    (value.message === null || typeof value.message === "string") &&
    (value.toolCallId === null || typeof value.toolCallId === "string") &&
    (value.metadata === null || isRecord(value.metadata))
  );
}

function isAgentSessionStatus(
  value: unknown,
): value is AgentSessionSnapshot["status"] {
  return (
    value === "active" ||
    value === "waiting_user" ||
    value === "completed" ||
    value === "cancelled" ||
    value === "failed"
  );
}

function hashUserId(userId: string): string {
  return `sha256:${createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;
}

function hashIdPart(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function sanitizeIdPart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized || "thread";
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
