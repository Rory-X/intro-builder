import { and, eq } from "drizzle-orm";
import { RunAgentInputSchema } from "@ag-ui/core";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import { mapAgUiRunToAgentMessageRequest } from "@/lib/agent/ag-ui-run-adapter";
import { createAgentRunSessionContext } from "@/lib/agent/run-session";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

const DEFAULT_AGENT_PUBLIC_BASE_URL = "http://127.0.0.1:8787";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  return Response.json({
    status: "ok",
    streamUrl: joinUrl(resolveAgentPublicBaseUrl(), "/v1/agent/messages"),
    token: signed.token,
    tokenExpiresAt: signed.expiresAt.toISOString(),
    request: {
      ...mapped.request,
      sessionContext,
    },
  });
}

function resolveAgentPublicBaseUrl(): string {
  return (
    process.env.AGENT_PUBLIC_BASE_URL ??
    process.env.NEXT_PUBLIC_AGENT_BASE_URL ??
    process.env.AGENT_BASE_URL ??
    DEFAULT_AGENT_PUBLIC_BASE_URL
  );
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
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
