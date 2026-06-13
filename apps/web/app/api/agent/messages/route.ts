import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import {
  AgentClientError,
  createAgentClient,
} from "@/lib/agent/client";
import { signAgentToken } from "@/lib/agent/token";
import type {
  AgentChatMessage,
  AgentMessageRequest,
  AgentResumeContext,
  AgentWorkflowId,
} from "@intro-builder/shared/types";
import { currentUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const parsed = await readAgentMessageRequest(req);
  if (!parsed.ok) {
    return Response.json({ error: parsed.message }, { status: 400 });
  }

  if (parsed.request.resumeId !== null) {
    const resume = await db.query.resumes.findFirst({
      where: and(
        eq(resumes.id, parsed.request.resumeId),
        eq(resumes.userId, userId),
      ),
    });
    if (!resume) {
      return Response.json({ error: "简历不存在" }, { status: 404 });
    }
  }

  try {
    const signed = await signAgentToken({
      userId,
      ...(parsed.request.resumeId ? { resumeId: parsed.request.resumeId } : {}),
      scope: "agent:chat",
    });
    const agent = createAgentClient();
    if (acceptsAgUiSse(req)) {
      const result = await agent.streamAgentMessage({
        token: signed.token,
        request: parsed.request,
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
    }

    const result = await agent.sendAgentMessage({
      token: signed.token,
      request: parsed.request,
    });

    return Response.json({
      status: "ok",
      tokenExpiresAt: signed.expiresAt.toISOString(),
      requestId: result.requestId,
      message: result.data.message,
      toolCalls: result.data.toolCalls,
      proposedOperations: result.data.proposedOperations,
      usage: result.data.usage,
      ...(result.data.cached
        ? { cached: true, cachedAt: result.data.cachedAt }
        : {}),
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

    console.error("[agent-messages] route failed:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }
}

async function readAgentMessageRequest(
  req: Request,
): Promise<{ ok: true; request: AgentMessageRequest } | { ok: false; message: string }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, message: "请求体必须是合法 JSON" };
  }

  if (!isRecord(body)) return { ok: false, message: "请求体必须是对象" };
  const mode =
    body.mode === "create_from_zero" || body.resumeId === null
      ? "create_from_zero"
      : "optimize_existing";
  if (mode === "optimize_existing" && !isNonEmptyString(body.resumeId)) {
    return { ok: false, message: "缺少 resumeId" };
  }
  if (mode === "create_from_zero" && body.resumeId !== null) {
    return { ok: false, message: "从零创建不能绑定已有简历" };
  }
  if (body.locale !== "zh-CN") return { ok: false, message: "locale 必须是 zh-CN" };
  const workflowId =
    body.workflowId ?? (mode === "create_from_zero" ? "create-from-zero" : null);
  if (!isSupportedWorkflowId(workflowId)) {
    return { ok: false, message: "workflowId 不支持" };
  }
  if (!Array.isArray(body.messages) || !body.messages.every(isAgentChatMessage)) {
    return { ok: false, message: "messages 不合法" };
  }
  if (body.messages.length === 0) {
    return { ok: false, message: "messages 不能为空" };
  }
  if (mode === "create_from_zero" && body.context !== null) {
    return { ok: false, message: "从零创建不能读取已有简历上下文" };
  }
  if (mode === "optimize_existing" && !isAgentResumeContext(body.context)) {
    return { ok: false, message: "context 不合法" };
  }
  const resumeId: string | null =
    mode === "create_from_zero" ? null : String(body.resumeId);
  const context: AgentResumeContext | null =
    mode === "create_from_zero" ? null : (body.context as AgentResumeContext);

  return {
    ok: true,
    request: {
      resumeId,
      ...(mode === "create_from_zero" ? { mode } : {}),
      locale: body.locale,
      workflowId,
      messages: body.messages,
      context,
    },
  };
}

function isSupportedWorkflowId(value: unknown): value is AgentWorkflowId | null {
  return (
    value === null ||
    value === "resume-diagnose" ||
    value === "target-role-match" ||
    value === "experience-star" ||
    value === "pre-export-check" ||
    value === "create-from-zero"
  );
}

function isAgentChatMessage(value: unknown): value is AgentChatMessage {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    (value.role === "user" || value.role === "assistant") &&
    isNonEmptyString(value.content)
  );
}

function isAgentResumeContext(value: unknown): value is AgentResumeContext {
  if (!isRecord(value)) return false;
  if (typeof value.resumeTitle !== "string") return false;
  if (!isNonEmptyString(value.templateId)) return false;
  if (!(value.activeSection === null || typeof value.activeSection === "string")) return false;
  if (!isRecord(value.completeness)) return false;
  if (typeof value.completeness.overall !== "number") return false;
  if (!Array.isArray(value.completeness.sections)) return false;
  if (!Array.isArray(value.sections)) return false;

  return (
    value.completeness.sections.every(isCompletenessSection) &&
    value.sections.every(isAgentContextSection)
  );
}

function isCompletenessSection(value: unknown): value is {
  key: string;
  label: string;
  score: number;
  max: number;
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.key) &&
    isNonEmptyString(value.label) &&
    typeof value.score === "number" &&
    typeof value.max === "number"
  );
}

function isAgentContextSection(value: unknown): value is {
  key: string;
  label: string;
  fieldPath: string;
  plainText: string;
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.key) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.fieldPath) &&
    typeof value.plainText === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function acceptsAgUiSse(req: Request): boolean {
  const accept = req.headers.get("accept");
  return Boolean(accept?.split(",").some((value) => {
    const mediaType = value.split(";")[0]?.trim().toLowerCase();
    return mediaType === "text/event-stream";
  }));
}
