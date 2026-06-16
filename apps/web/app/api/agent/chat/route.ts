import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

/**
 * BFF for the agent chat stream. Signs a short-lived `agent:chat` JWT (keeping
 * the model + agent address server-side, reusing the Auth.js cookie) and proxies
 * the AI SDK UI message stream from the Hono agent's `/v1/agent/chat` back to the
 * browser, where assistant-ui's AI SDK runtime consumes it.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8787";

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.text();
  let resumeId: string | undefined;
  try {
    const parsed = JSON.parse(body) as { resumeId?: unknown };
    if (typeof parsed.resumeId === "string" && parsed.resumeId) {
      resumeId = parsed.resumeId;
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

  let signed;
  try {
    signed = await signAgentToken({
      userId,
      ...(resumeId ? { resumeId } : {}),
      scope: "agent:chat",
    });
  } catch (error) {
    console.error("[agent-chat] failed to sign token:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_BASE_URL}/v1/agent/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${signed.token}`,
      },
      body,
    });
  } catch (error) {
    console.error("[agent-chat] upstream fetch failed:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-agent-token-expires-at": signed.expiresAt.toISOString(),
    },
  });
}
