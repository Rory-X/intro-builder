import { createHash } from "node:crypto";

import type {
  AgentResumeSessionMode,
  AgentRunSessionContext,
  AgentWorkflowId,
} from "@intro-builder/shared/types";

export function createAgentRunSessionContext({
  resumeId,
  userId,
  threadId,
  mode,
  workflowId,
  resumeTitle,
}: {
  resumeId: string | null;
  userId: string;
  threadId: string;
  mode: AgentResumeSessionMode;
  workflowId: AgentWorkflowId | null;
  resumeTitle: string;
}): AgentRunSessionContext {
  return {
    sessionId: agentRunSessionId({ resumeId, userId, threadId }),
    threadId,
    resumeId,
    mode,
    workflowId,
    resumeTitle,
  };
}

export function agentRunSessionId({
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

function hashIdPart(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function sanitizeIdPart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized || "thread";
}
