import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

/**
 * Fallback BFF for the agent chat stream. The preferred path is browser → agent
 * direct (the session BFF returns the agent's public URL + JWT). This route
 * exists as a fallback when the agent is not publicly reachable from the browser
 * (e.g. firewall/VPN), proxying the SSE stream through Vercel's serverless.
 *
 * ⚠️  Vercel caps serverless responses at 120 s (maxDuration below). Long agent
 * runs should use the direct path when possible.
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
  // Check if the request already carries an Authorization header (direct-path
  // fallback — the browser sends the JWT). If so, bypass re-signing.
  const existingAuth = req.headers.get("authorization");

  let resumeId: string | undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
    const obj = parsed as { resumeId?: unknown };
    if (typeof obj.resumeId === "string" && obj.resumeId) {
      resumeId = obj.resumeId;
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

  let authHeader: string;
  if (existingAuth && existingAuth.startsWith("Bearer ")) {
    // Direct-path fallback: JWT already signed by session BFF.
    authHeader = existingAuth;
  } else {
    // Normal BFF path: sign a fresh JWT.
    try {
      const signed = await signAgentToken({
        userId,
        ...(resumeId ? { resumeId } : {}),
        scope: "agent:chat",
      });
      authHeader = `Bearer ${signed.token}`;
    } catch (error) {
      console.error("[agent-chat] failed to sign token:", error);
      return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
    }
  }

  // Filter body to only include fields agent expects: sessionId, messages, mode, modelConfig.
  const obj = parsed as Record<string, unknown>;
  const agentBody: Record<string, unknown> = {};
  if (typeof obj.sessionId === "string") agentBody.sessionId = obj.sessionId;
  if (Array.isArray(obj.messages)) agentBody.messages = obj.messages;
  if (typeof obj.mode === "string") agentBody.mode = obj.mode;
  if (obj.modelConfig) agentBody.modelConfig = obj.modelConfig;

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_BASE_URL}/v1/agent/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: authHeader,
      },
      body: JSON.stringify(agentBody),
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
    },
  });
}
