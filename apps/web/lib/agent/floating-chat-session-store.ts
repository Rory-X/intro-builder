import { and, eq, lt } from "drizzle-orm";

import { db } from "@/db";
import {
  agentFloatingChatMessages,
  agentFloatingChatSessions,
} from "@/db/schema";
import type { ResumeOperation } from "@intro-builder/shared/types";

export type FloatingChatSessionListItem = {
  id: string;
  title: string;
  updatedAt: string;
};

export type FloatingChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: Array<Record<string, unknown>>;
  toolCalls: Array<Record<string, unknown>>;
  operations: ResumeOperation[];
  createdAt: string;
};

type FloatingToolCall = {
  id: string;
  name: string;
  status: "completed" | "error";
  summary: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export async function listFloatingChatSessions({
  userId,
  resumeId,
}: {
  userId: string;
  resumeId: string;
}): Promise<FloatingChatSessionListItem[]> {
  const rows = await db.query.agentFloatingChatSessions.findMany({
    where: and(
      eq(agentFloatingChatSessions.userId, userId),
      eq(agentFloatingChatSessions.resumeId, resumeId),
    ),
    orderBy: (sessions, { desc }) => [desc(sessions.updatedAt)],
    columns: {
      id: true,
      title: true,
      updatedAt: true,
    },
  });
  return rows.map(toSessionListItem);
}

export async function createFloatingChatSession({
  userId,
  resumeId,
}: {
  userId: string;
  resumeId: string;
}): Promise<FloatingChatSessionListItem> {
  const [row] = await db
    .insert(agentFloatingChatSessions)
    .values({
      userId,
      resumeId,
      title: "新对话",
    })
    .returning({
      id: agentFloatingChatSessions.id,
      title: agentFloatingChatSessions.title,
      updatedAt: agentFloatingChatSessions.updatedAt,
    });
  return toSessionListItem(row);
}

export async function getFloatingChatSession({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}) {
  return db.query.agentFloatingChatSessions.findFirst({
    where: and(
      eq(agentFloatingChatSessions.id, sessionId),
      eq(agentFloatingChatSessions.userId, userId),
    ),
    columns: {
      id: true,
      title: true,
      resumeId: true,
      updatedAt: true,
    },
  });
}

export async function deleteFloatingChatSession({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}): Promise<boolean> {
  const result = await db
    .delete(agentFloatingChatSessions)
    .where(
      and(
        eq(agentFloatingChatSessions.id, sessionId),
        eq(agentFloatingChatSessions.userId, userId),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

export async function listFloatingChatMessages({
  sessionId,
  before,
  limit = 30,
}: {
  sessionId: string;
  before?: string | null;
  limit?: number;
}) {
  const beforeDate = before ? new Date(before) : null;
  const rows = await db.query.agentFloatingChatMessages.findMany({
    where:
      beforeDate && !Number.isNaN(beforeDate.getTime())
        ? and(
            eq(agentFloatingChatMessages.sessionId, sessionId),
            lt(agentFloatingChatMessages.createdAt, beforeDate),
          )
        : eq(agentFloatingChatMessages.sessionId, sessionId),
    orderBy: (messages, { desc }) => [desc(messages.createdAt)],
    limit: limit + 1,
  });
  const page = rows.slice(0, limit).reverse();
  return {
    messages: page.map(toChatMessage),
    hasMore: rows.length > limit,
    nextCursor: rows.length > limit ? rows[limit - 1]?.createdAt.toISOString() ?? null : null,
  };
}

export async function appendFloatingChatMessage({
  sessionId,
  role,
  content,
  parts = [],
  toolCalls = [],
  operations = [],
}: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  parts?: Array<Record<string, unknown>>;
  toolCalls?: FloatingToolCall[];
  operations?: ResumeOperation[];
}) {
  const [row] = await db
    .insert(agentFloatingChatMessages)
    .values({
      sessionId,
      role,
      content,
      parts,
      toolCalls,
      operations: operations as unknown as Array<Record<string, unknown>>,
    })
    .returning({
      id: agentFloatingChatMessages.id,
      role: agentFloatingChatMessages.role,
      content: agentFloatingChatMessages.content,
      parts: agentFloatingChatMessages.parts,
      toolCalls: agentFloatingChatMessages.toolCalls,
      operations: agentFloatingChatMessages.operations,
      createdAt: agentFloatingChatMessages.createdAt,
    });

  await db
    .update(agentFloatingChatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(agentFloatingChatSessions.id, sessionId));

  return toChatMessage(row);
}

export async function renameFloatingChatSession({
  sessionId,
  userId,
  title,
}: {
  sessionId: string;
  userId: string;
  title: string;
}): Promise<boolean> {
  const result = await db
    .update(agentFloatingChatSessions)
    .set({ title: title.trim().slice(0, 50), updatedAt: new Date() })
    .where(
      and(
        eq(agentFloatingChatSessions.id, sessionId),
        eq(agentFloatingChatSessions.userId, userId),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

function toSessionListItem(row: {
  id: string;
  title: string;
  updatedAt: Date;
}): FloatingChatSessionListItem {
  return {
    id: row.id,
    title: row.title || "新对话",
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toChatMessage(row: {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: Array<Record<string, unknown>> | null;
  toolCalls: Array<Record<string, unknown>> | null;
  operations: Array<Record<string, unknown>> | null;
  createdAt: Date;
}): FloatingChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    parts: row.parts ?? [],
    toolCalls: row.toolCalls ?? [],
    operations: (row.operations ?? []) as unknown as ResumeOperation[],
    createdAt: row.createdAt.toISOString(),
  };
}
