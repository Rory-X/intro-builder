import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8787";

/**
 * Minimal session BFF. It only validates resume ownership, signs a short-lived
 * JWT, and returns the sessionId + token + public agent URL. The browser then
 * connects to the agent directly for the chat data plane (SSE stream), avoiding
 * a Vercel serverless proxy bottleneck.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.text();
  let resumeId: string | undefined;
  let mode: string | undefined;
  try {
    const parsed = JSON.parse(body || "{}") as {
      resumeId?: unknown;
      mode?: unknown;
    };
    if (typeof parsed.resumeId === "string" && parsed.resumeId) {
      resumeId = parsed.resumeId;
    }
    if (typeof parsed.mode === "string" && parsed.mode) {
      mode = parsed.mode;
    }
  } catch {
    return Response.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  if (resumeId) {
    const resume = await db.query.resumes.findFirst({
      where: and(eq(resumes.id, resumeId), eq(resumes.userId, userId)),
    });
    if (!resume) {
      return Response.json({ error: "简历不存在" }, { status: 404 });
    }
  }

  // Sign one JWT for session creation + chat. The browser stores it and sends it
  // directly to the agent for the chat data plane.
  let signed;
  try {
    signed = await signAgentToken({
      userId,
      ...(resumeId ? { resumeId } : {}),
      scope: "agent:chat",
    });
  } catch (error) {
    console.error("[agent-session] failed to sign token:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }

  // Call the agent to upsert the session row in Postgres (create-or-resume).
  // Only the session bootstrap goes through BFF; the chat stream is direct.
  let sessionId: string;
  try {
    const upstream = await fetch(`${AGENT_BASE_URL}/v1/agent/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signed.token}`,
      },
      body: JSON.stringify({ resumeId: resumeId ?? null, mode }),
    });
    const data = (await upstream.json()) as { sessionId?: string };
    if (!upstream.ok || !data.sessionId) {
      return Response.json(
        { error: "无法创建会话" },
        { status: upstream.status || 502 },
      );
    }
    sessionId = data.sessionId;
  } catch (error) {
    console.error("[agent-session] upstream fetch failed:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }

  return Response.json({
    sessionId,
    token: signed.token,
    agentBaseUrl: AGENT_BASE_URL,
    tokenExpiresAt: signed.expiresAt.toISOString(),
  });
}
