import { and, eq } from "drizzle-orm";
import { RunAgentInputSchema } from "@ag-ui/core";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import {
  AgentClientError,
  createAgentClient,
} from "@/lib/agent/client";
import { mapAgUiRunToAgentMessageRequest } from "@/lib/agent/ag-ui-run-adapter";
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

  const resume = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, mapped.request.resumeId), eq(resumes.userId, userId)),
  });
  if (!resume) {
    return Response.json({ error: "简历不存在" }, { status: 404 });
  }

  try {
    const signed = await signAgentToken({
      userId,
      resumeId: mapped.request.resumeId,
      scope: "agent:chat",
    });
    const result = await createAgentClient().streamAgentMessage({
      token: signed.token,
      request: mapped.request,
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
