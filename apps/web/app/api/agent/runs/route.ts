import { and, eq } from "drizzle-orm";
import { RunAgentInputSchema } from "@ag-ui/core";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import {
  AgentClientError,
  createAgentClient,
} from "@/lib/agent/client";
import { mapAgUiRunToAgentMessageRequest } from "@/lib/agent/ag-ui-run-adapter";
import { createAgentRunSessionContext } from "@/lib/agent/run-session";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

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
    const sessionContext = createAgentRunSessionContext({
      resumeId: mapped.request.resumeId,
      userId,
      threadId: parsed.input.threadId,
      mode: mapped.request.mode ?? "optimize_existing",
      workflowId: mapped.request.workflowId,
      resumeTitle,
    });
    const signed = await signAgentToken({
      userId,
      ...(mapped.request.resumeId ? { resumeId: mapped.request.resumeId } : {}),
      scope: "agent:chat",
    });
    const result = await createAgentClient().streamAgentMessage({
      token: signed.token,
      request: {
        ...mapped.request,
        sessionContext,
      },
    });

    return new Response(result.data.body, {
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
