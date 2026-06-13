import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { RunAgentInputSchema } from "@ag-ui/core";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import {
  AgentClientError,
  createAgentClient,
} from "@/lib/agent/client";
import { mapAgUiRunToAgentMessageRequest } from "@/lib/agent/ag-ui-run-adapter";
import {
  loadAgentSessionSnapshot,
  persistAgentRunStream,
} from "@/lib/agent/session-store";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const parsed = await readAgUiRun(req);
  if (!parsed.ok) {
    return Response.json({ error: parsed.message }, { status: 400 });
  }

  const mapped = mapAgUiRunToAgentMessageRequest(parsed.input);
  if (!mapped.ok) {
    return Response.json({ error: mapped.message }, { status: 400 });
  }

  let resumeTitle = "Agent 会话";
  if (mapped.request.resumeId !== null) {
    const resume = await db.query.resumes.findFirst({
      where: and(
        eq(resumes.id, mapped.request.resumeId),
        eq(resumes.userId, userId),
      ),
    });
    if (!resume) {
      return Response.json({ error: "简历不存在" }, { status: 404 });
    }
    resumeTitle = resume.title || mapped.request.context?.resumeTitle || resumeTitle;
  } else {
    resumeTitle = "从 0 创建简历";
  }

  try {
    const threadId = agentRunThreadId(
      mapped.request.resumeId,
      parsed.input.threadId,
    );
    const sessionId = agentRunSessionId({
      resumeId: mapped.request.resumeId,
      userId,
      threadId,
    });
    const sessionSnapshot = await loadAgentSessionSnapshotForRun({
      sessionId,
      userId,
      resumeId: mapped.request.resumeId,
    });
    const signed = await signAgentToken({
      userId,
      ...(mapped.request.resumeId ? { resumeId: mapped.request.resumeId } : {}),
      scope: "agent:chat",
    });
    const result = await createAgentClient().streamAgentMessage({
      token: signed.token,
      request: sessionSnapshot
        ? { ...mapped.request, sessionSnapshot }
        : mapped.request,
    });
    const [browserBody, persistenceBody] = result.data.body.tee();
    persistAgentRunStreamInBackground({
      body: persistenceBody,
      contentType: result.data.contentType,
      runId: result.requestId,
      session: {
        sessionId,
        threadId,
        userId,
        resumeId: mapped.request.resumeId,
        mode: mapped.request.mode ?? "optimize_existing",
        workflowId: mapped.request.workflowId,
        resumeTitle,
      },
    });

    return new Response(browserBody, {
      status: 200,
      headers: {
        "content-type": result.data.contentType,
        "cache-control": "no-cache, no-transform",
        "x-request-id": result.requestId,
        "x-agent-token-expires-at": signed.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AgentClientError) {
      return Response.json(
        {
          error: "Agent 服务暂不可用",
          code: error.error,
          requestId: error.requestId,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        { status: error.statusCode },
      );
    }

    console.error("[agent-runs] route failed:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }
}

function agentRunSessionId({
  resumeId,
  userId,
  threadId,
}: {
  resumeId: string | null;
  userId: string;
  threadId: string;
}): string {
  if (resumeId) return `agent_session_${resumeId}`;
  return [
    "agent_session_create_from_zero",
    hashIdPart(userId),
    sanitizeIdPart(threadId),
  ].join("_");
}

function agentRunThreadId(resumeId: string | null, inputThreadId: string): string {
  return resumeId ? inputThreadId : inputThreadId;
}

function hashIdPart(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function sanitizeIdPart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized || "thread";
}

async function loadAgentSessionSnapshotForRun(
  input: Parameters<typeof loadAgentSessionSnapshot>[0],
) {
  try {
    return await loadAgentSessionSnapshot(input);
  } catch (error) {
    console.error("[agent-runs] session snapshot load failed:", error);
    return null;
  }
}

function persistAgentRunStreamInBackground(
  input: Parameters<typeof persistAgentRunStream>[0],
) {
  try {
    void Promise.resolve(persistAgentRunStream(input)).catch((error) => {
      console.error("[agent-runs] session persistence failed:", error);
    });
  } catch (error) {
    console.error("[agent-runs] session persistence failed:", error);
  }
}

async function readAgUiRun(
  req: Request,
): Promise<
  | { ok: true; input: ReturnType<typeof RunAgentInputSchema.parse> }
  | { ok: false; message: string }
> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, message: "请求体必须是合法 JSON" };
  }

  const parsed = RunAgentInputSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, message: "AG-UI run input 不合法" };
  }

  return { ok: true, input: parsed.data };
}
