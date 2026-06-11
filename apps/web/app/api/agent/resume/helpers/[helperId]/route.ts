import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import {
  AgentClientError,
  createAgentClient,
  type ResumeHelperId,
  type ResumeHelperRequest,
} from "@/lib/agent/client";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ helperId: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { helperId: rawHelperId } = await context.params;
  if (!isSupportedHelperId(rawHelperId)) {
    return Response.json({ error: "helperId 不支持" }, { status: 404 });
  }

  const parsed = await readResumeHelperRequest(req, rawHelperId);
  if (!parsed.ok) {
    return Response.json({ error: parsed.message }, { status: 400 });
  }

  const resume = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, parsed.request.resumeId), eq(resumes.userId, userId)),
  });
  if (!resume) {
    return Response.json({ error: "简历不存在" }, { status: 404 });
  }

  try {
    const signed = await signAgentToken({
      userId,
      resumeId: parsed.request.resumeId,
      scope: "resume:helper",
    });
    const agent = createAgentClient();
    const result = await agent.runResumeHelper({
      token: signed.token,
      helperId: rawHelperId,
      request: parsed.request,
    });

    return Response.json({
      status: "ok",
      tokenExpiresAt: signed.expiresAt.toISOString(),
      requestId: result.requestId,
      helperId: result.data.helperId,
      result: result.data.result,
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

    console.error("[agent-resume-helper] route failed:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }
}

async function readResumeHelperRequest(
  req: Request,
  helperId: ResumeHelperId,
): Promise<{ ok: true; request: ResumeHelperRequest } | { ok: false; message: string }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, message: "请求体必须是合法 JSON" };
  }

  if (!isRecord(body)) return { ok: false, message: "请求体必须是对象" };
  if (!isNonEmptyString(body.resumeId)) return { ok: false, message: "缺少 resumeId" };
  if (body.locale !== "zh-CN") return { ok: false, message: "locale 必须是 zh-CN" };
  if (!isValidTarget(helperId, body.target)) return { ok: false, message: "target 不合法" };
  if (!isValidContext(body.context)) return { ok: false, message: "context 不合法" };
  if (!isValidIntent(helperId, body.intent)) return { ok: false, message: "intent 不合法" };
  if (helperId === "section-next-steps" && body.target.section === null) {
    return { ok: false, message: "section-next-steps 需要 target.section" };
  }
  if (body.context.sections.length === 0) {
    return { ok: false, message: "context.sections 不能为空" };
  }
  const totalPlainTextLength = body.context.sections.reduce(
    (sum, section) => sum + section.plainText.length,
    0,
  );
  if (totalPlainTextLength > 12_000) {
    return { ok: false, message: "context plainText 不能超过 12000 字" };
  }

  return {
    ok: true,
    request: {
      resumeId: body.resumeId,
      locale: body.locale,
      target: body.target,
      context: body.context,
      intent: body.intent,
    },
  };
}

function isSupportedHelperId(value: string): value is ResumeHelperId {
  return value === "resume-diagnose" || value === "section-next-steps";
}

function isValidTarget(
  helperId: ResumeHelperId,
  value: unknown,
): value is ResumeHelperRequest["target"] {
  if (!isRecord(value)) return false;
  if (helperId === "resume-diagnose") {
    return value.kind === "resume" && value.section === null && value.fieldPath === null;
  }
  return (
    value.kind === "section" &&
    isSupportedSection(value.section) &&
    (value.fieldPath === null || typeof value.fieldPath === "string")
  );
}

function isValidContext(value: unknown): value is ResumeHelperRequest["context"] {
  if (!isRecord(value)) return false;
  if (typeof value.resumeTitle !== "string") return false;
  if (!isRecord(value.completeness)) return false;
  if (typeof value.completeness.overall !== "number") return false;
  if (!Array.isArray(value.completeness.sections)) return false;
  if (!Array.isArray(value.sections)) return false;

  return (
    value.completeness.sections.every(isCompletenessSection) &&
    value.sections.every(isContextSection)
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

function isContextSection(value: unknown): value is {
  key: string;
  label: string;
  plainText: string;
} {
  return (
    isRecord(value) &&
    isNonEmptyString(value.key) &&
    isNonEmptyString(value.label) &&
    typeof value.plainText === "string"
  );
}

function isValidIntent(
  helperId: ResumeHelperId,
  value: unknown,
): value is ResumeHelperRequest["intent"] {
  if (!isRecord(value)) return false;
  const expectedMode = helperId === "resume-diagnose" ? "diagnose" : "next_steps";
  const maxSuggestions = value.maxSuggestions;
  return (
    value.mode === expectedMode &&
    typeof maxSuggestions === "number" &&
    Number.isInteger(maxSuggestions) &&
    maxSuggestions >= 1 &&
    maxSuggestions <= 5 &&
    (value.strategy === "plain" || value.strategy === "star")
  );
}

function isSupportedSection(
  value: unknown,
): value is Extract<ResumeHelperRequest["target"], { kind: "section" }>["section"] {
  return (
    value === "summary" ||
    value === "experience" ||
    value === "projects" ||
    value === "education" ||
    value === "skills" ||
    value === "research" ||
    value === "custom"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
