import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import {
  AgentClientError,
  createAgentClient,
  type RichTextPolishRequest,
} from "@/lib/agent/client";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const parsed = await readPolishRequest(req);
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
      scope: "rich_text:polish",
    });
    const agent = createAgentClient();
    const result = await agent.polishRichText({
      token: signed.token,
      request: parsed.request,
    });

    return Response.json({
      status: "ok",
      tokenExpiresAt: signed.expiresAt.toISOString(),
      requestId: result.requestId,
      result: result.data.result,
      usage: result.data.usage,
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

    console.error("[agent-rich-text-polish] route failed:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }
}

async function readPolishRequest(
  req: Request,
): Promise<{ ok: true; request: RichTextPolishRequest } | { ok: false; message: string }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, message: "请求体必须是合法 JSON" };
  }

  if (!isRecord(body)) return { ok: false, message: "请求体必须是对象" };
  if (!isNonEmptyString(body.resumeId)) return { ok: false, message: "缺少 resumeId" };
  if (!isSupportedSection(body.section)) return { ok: false, message: "section 不支持" };
  if (!isNonEmptyString(body.fieldPath)) return { ok: false, message: "缺少 fieldPath" };
  if (body.locale !== "zh-CN") return { ok: false, message: "locale 必须是 zh-CN" };
  if (!isRecord(body.content)) return { ok: false, message: "缺少 content" };
  if (body.content.format !== "plain_text" && body.content.format !== "tiptap_json") {
    return { ok: false, message: "content.format 不支持" };
  }
  if (!isNonEmptyString(body.content.plainText)) {
    return { ok: false, message: "缺少 content.plainText" };
  }
  if (body.content.plainText.length > 4_000) {
    return { ok: false, message: "content.plainText 不能超过 4000 字" };
  }
  if (!isRecord(body.intent)) return { ok: false, message: "缺少 intent" };
  if (body.intent.mode !== "polish") return { ok: false, message: "intent.mode 必须是 polish" };
  if (!isSupportedTone(body.intent.tone)) return { ok: false, message: "intent.tone 不支持" };
  if (!isSupportedLength(body.intent.length)) return { ok: false, message: "intent.length 不支持" };
  if (
    body.intent.strategy !== undefined &&
    body.intent.strategy !== "plain" &&
    body.intent.strategy !== "star"
  ) {
    return { ok: false, message: "intent.strategy 不支持" };
  }

  return {
    ok: true,
    request: {
      resumeId: body.resumeId,
      section: body.section,
      fieldPath: body.fieldPath,
      locale: body.locale,
      content: {
        format: body.content.format,
        plainText: body.content.plainText.trim(),
        ...(body.content.tiptapJson === undefined
          ? {}
          : { tiptapJson: body.content.tiptapJson }),
      },
      intent: {
        mode: body.intent.mode,
        tone: body.intent.tone,
        length: body.intent.length,
        ...(body.intent.strategy === undefined
          ? {}
          : { strategy: body.intent.strategy }),
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isSupportedSection(
  value: unknown,
): value is RichTextPolishRequest["section"] {
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

function isSupportedTone(value: unknown): value is RichTextPolishRequest["intent"]["tone"] {
  return value === "professional" || value === "confident" || value === "concise";
}

function isSupportedLength(
  value: unknown,
): value is RichTextPolishRequest["intent"]["length"] {
  return value === "same" || value === "shorter" || value === "longer";
}
