import { createHash, randomUUID } from "node:crypto";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { and, eq, isNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { agentSessionEvents, agentSessions } from "@/db/schema";
import { readAgUiSseStream } from "@/lib/agent/ag-ui-stream";
import type {
  AgentContextStatusSnapshot,
  AgentResumeSessionMode,
  AgentResumeWorkspaceSnapshot,
  AgentSessionInterrupt,
  AgentSessionSnapshot,
  AgentWorkflowId,
} from "@intro-builder/shared/types";

export type CreateAgentSessionSnapshotInput = {
  sessionId: string;
  threadId: string;
  userId: string;
  resumeId: string | null;
  mode: AgentResumeSessionMode;
  workflowId: AgentWorkflowId | "create-from-zero" | null;
  resumeTitle: string;
  now: string;
};

export type PersistAgentRunSession = Omit<
  CreateAgentSessionSnapshotInput,
  "now"
>;

export type PersistAgentRunStreamInput = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  runId: string;
  session: PersistAgentRunSession;
};

export type LoadAgentSessionSnapshotInput = {
  sessionId: string;
  userId: string;
  resumeId: string | null;
};

type AgentSessionEventInsert = typeof agentSessionEvents.$inferInsert;

const EVENT_INSERT_BATCH_SIZE = 25;

export function createInitialAgentSessionSnapshot({
  sessionId,
  threadId,
  userId,
  resumeId,
  mode,
  workflowId,
  resumeTitle,
  now,
}: CreateAgentSessionSnapshotInput): AgentSessionSnapshot {
  return {
    sessionId,
    threadId,
    resumeId,
    userIdHash: hashUserId(userId),
    mode,
    status: "active",
    workflow: {
      workflowId,
      nodeId: "intake_goal",
      loopCount: 0,
      completedNodeIds: [],
    },
    workspace: {
      resumeId,
      mode,
      goal: {
        workflowId,
        resumeTitle,
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

export async function loadAgentSessionSnapshot({
  sessionId,
  userId,
  resumeId,
}: LoadAgentSessionSnapshotInput): Promise<AgentSessionSnapshot | null> {
  const row = await db.query.agentSessions.findFirst({
    where: and(
      eq(agentSessions.id, sessionId),
      eq(agentSessions.userId, userId),
      resumeId === null
        ? isNull(agentSessions.resumeId)
        : eq(agentSessions.resumeId, resumeId),
    ),
  });
  const snapshot = row?.stateJson;
  if (!isAgentSessionSnapshot(snapshot)) return null;
  if (snapshot.sessionId !== sessionId) return null;
  if (snapshot.resumeId !== resumeId) return null;
  return snapshot;
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

export async function persistAgentRunStream({
  body,
  contentType,
  runId,
  session,
}: PersistAgentRunStreamInput): Promise<void> {
  let snapshot = createInitialAgentSessionSnapshot({
    ...session,
    now: new Date().toISOString(),
  });
  await ensureAgentSessionRow({ snapshot, userId: session.userId });

  const response = new Response(body, {
    headers: { "content-type": contentType },
  });

  let sequence = 0;
  const eventBatch: AgentSessionEventInsert[] = [];
  for await (const event of readAgUiSseStream(response)) {
    sequence += 1;
    eventBatch.push({
      id: randomUUID(),
      sessionId: snapshot.sessionId,
      runId,
      sequence,
      type: event.type,
      payloadJson: event as unknown as Record<string, unknown>,
    });
    if (eventBatch.length >= EVENT_INSERT_BATCH_SIZE) {
      await flushAgentSessionEventBatch(eventBatch);
    }
    snapshot = reduceAgentSessionSnapshot(snapshot, event);
  }

  await flushAgentSessionEventBatch(eventBatch);
  await upsertAgentSessionSnapshot({ snapshot, userId: session.userId });
}

async function flushAgentSessionEventBatch(
  eventBatch: AgentSessionEventInsert[],
): Promise<void> {
  if (eventBatch.length === 0) return;
  const values = eventBatch.splice(0, eventBatch.length);
  await db.insert(agentSessionEvents).values(values);
}

async function ensureAgentSessionRow({
  snapshot,
  userId,
}: {
  snapshot: AgentSessionSnapshot;
  userId: string;
}): Promise<void> {
  await db
    .insert(agentSessions)
    .values(agentSessionRowValues({ snapshot, userId }))
    .onConflictDoNothing({ target: agentSessions.id });
}

async function upsertAgentSessionSnapshot({
  snapshot,
  userId,
}: {
  snapshot: AgentSessionSnapshot;
  userId: string;
}): Promise<void> {
  await db
    .insert(agentSessions)
    .values(agentSessionRowValues({ snapshot, userId }))
    .onConflictDoUpdate({
      target: agentSessions.id,
      set: {
        status: snapshot.status,
        stateJson: snapshot,
        lastResumeContentHash: snapshot.lastResumeContentHash,
        updatedAt: new Date(snapshot.updatedAt),
      },
    });
}

function agentSessionRowValues({
  snapshot,
  userId,
}: {
  snapshot: AgentSessionSnapshot;
  userId: string;
}) {
  return {
    id: snapshot.sessionId,
    userId,
    resumeId: snapshot.resumeId,
    mode: snapshot.mode,
    status: snapshot.status,
    title: snapshot.workspace.goal.resumeTitle || "Agent 会话",
    stateJson: snapshot,
    lastResumeContentHash: snapshot.lastResumeContentHash,
    updatedAt: new Date(snapshot.updatedAt),
  };
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

export type AgentSessionListItem = {
  sessionId: string;
  threadId: string;
  title: string;
  status: string;
  updatedAt: string;
};

export async function listAgentSessions({
  userId,
  resumeId,
}: {
  userId: string;
  resumeId: string | null;
}): Promise<AgentSessionListItem[]> {
  const rows = await db.query.agentSessions.findMany({
    where: and(
      eq(agentSessions.userId, userId),
      resumeId === null
        ? isNull(agentSessions.resumeId)
        : eq(agentSessions.resumeId, resumeId),
    ),
    orderBy: (sessions, { desc }) => [desc(sessions.updatedAt)],
    columns: {
      id: true,
      title: true,
      status: true,
      stateJson: true,
      updatedAt: true,
    },
  });
  return rows.map((row) => ({
    sessionId: row.id,
    threadId: isAgentSessionSnapshot(row.stateJson)
      ? row.stateJson.threadId
      : row.id,
    title: row.title ?? "Agent 会话",
    status: row.status ?? "active",
    updatedAt: row.updatedAt?.toISOString() ?? "",
  }));
}

export async function deleteAgentSession({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}): Promise<boolean> {
  const result = await db
    .delete(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)));
  return (result.rowCount ?? 0) > 0;
}

export async function renameAgentSession({
  sessionId,
  userId,
  title,
}: {
  sessionId: string;
  userId: string;
  title: string;
}): Promise<boolean> {
  const result = await db
    .update(agentSessions)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)));
  return (result.rowCount ?? 0) > 0;
}

export async function paginateAgentSessionEvents({
  sessionId,
  beforeSequence,
  limit = 20,
}: {
  sessionId: string;
  beforeSequence?: number;
  limit?: number;
}) {
  const where = beforeSequence
    ? and(eq(agentSessionEvents.sessionId, sessionId), lt(agentSessionEvents.sequence, beforeSequence))
    : eq(agentSessionEvents.sessionId, sessionId);

  return db.query.agentSessionEvents.findMany({
    where,
    orderBy: (events, { desc }) => [desc(events.sequence)],
    limit,
  });
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

function isWorkflowCursor(
  value: unknown,
): value is AgentSessionSnapshot["workflow"] {
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

function isDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
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

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
