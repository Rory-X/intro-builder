import { AgentClientError, createAgentClient } from "@/lib/agent/client";
import { getAgentJwtSecretDiagnostics } from "@/lib/agent/secret";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export async function GET(req?: Request) {
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

function isDebugRequest(req: Request | undefined): boolean {
  if (!req) return false;
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
