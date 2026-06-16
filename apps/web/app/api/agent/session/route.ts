import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import { AgentClientError, createAgentClient } from "@/lib/agent/client";
import { getAgentJwtSecretDiagnostics } from "@/lib/agent/secret";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

const AGENT_BASE_URL = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8787";

/**
 * Open (or resume) an agent session. Signs an `agent:session` JWT and proxies to
 * the Hono agent's `POST /v1/agent/session`, which upserts the durable session
 * row in Postgres and returns the current preview snapshot.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = await req.text();
  let resumeId: string | undefined;
  try {
    const parsed = JSON.parse(body || "{}") as { resumeId?: unknown };
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
      scope: "agent:session",
    });
  } catch (error) {
    console.error("[agent-session] failed to sign token:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AGENT_BASE_URL}/v1/agent/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${signed.token}`,
      },
      body: body || "{}",
    });
  } catch (error) {
    console.error("[agent-session] upstream fetch failed:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-agent-token-expires-at": signed.expiresAt.toISOString(),
    },
  });
}

export async function GET(req: Request) {
  const debug = isDebugRequest(req);
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const signed = await signAgentToken({
      userId,
      scope: "agent:session",
    });
    const agent = createAgentClient();
    const result = await agent.getSession({ token: signed.token });

    return Response.json({
      status: "ok",
      tokenExpiresAt: signed.expiresAt.toISOString(),
      agent: result.data,
      requestId: result.requestId,
    });
  } catch (error) {
    if (error instanceof AgentClientError) {
      return Response.json(
        {
          error: "Agent 服务暂不可用",
          code: error.error,
          requestId: error.requestId,
          retryAfterSeconds: error.retryAfterSeconds,
          ...(debug ? { debug: getAgentRuntimeDebug() } : {}),
        },
        { status: error.statusCode },
      );
    }

    console.error("[agent-session] smoke route failed:", error);
    return Response.json(
      {
        error: "Agent 服务暂不可用",
        ...(debug ? { debug: getAgentRuntimeDebug() } : {}),
      },
      { status: 503 },
    );
  }
}

function isDebugRequest(req: Request): boolean {
  return new URL(req.url).searchParams.get("debug") === "1";
}

function getAgentRuntimeDebug() {
  return {
    agentBaseUrl: process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8787",
    jwtAudience: process.env.AGENT_JWT_AUDIENCE ?? "intro-builder-agent",
    jwtIssuer: process.env.AGENT_JWT_ISSUER ?? "intro-builder-web",
    jwtSecret: getAgentJwtSecretDiagnostics(),
  };
}
