import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { LanguageModel, UIMessage } from "ai";

import {
  authenticateAgentRequest,
  type AgentReplayStore,
} from "../auth.js";
import type {
  AgentRunSessionContext,
  AgentResumeSessionMode,
  AgentSessionSnapshot,
} from "../agent-messages.js";
import type { ResumeOperation } from "../agent-tools.js";
import {
  createInitialAgentSessionSnapshot,
  deriveAgentSessionId,
  type AgentSessionStore,
} from "../session-store.js";
import {
  createPreview,
  previewSnapshot,
  type PreviewState,
} from "../agent/preview.js";
import { createChatModel, streamAgentChat, type StreamAgentChatOptions } from "../agent/chat-runtime.js";
import { createDrizzleResumeReader } from "../agent/resume-reader.js";
import type { ResumeReader } from "../agent/tools.js";
import type { AgentConfig } from "../config.js";
import { createErrorEnvelope, type AgentErrorCode } from "../errors.js";
import type { RedisReadyResult } from "../redis.js";
import type { AiCacheStore } from "../ai-cache.js";
import { checkRateLimit, type RateLimitRedis } from "../rate-limit.js";
import {
  polishRichText,
  RichTextPolishProviderError,
  validateRichTextPolishRequest,
  type RichTextPolishProvider,
  type RichTextPolishRunResult,
} from "../rich-text-polish.js";
import {
  buildResumeHelperPrompt,
  parseResumeHelperProviderResponse,
  validateResumeHelperRequest,
  type ResumeHelperProvider,
  type ResumeHelperResult,
  type ResumeHelperUsage,
} from "../resume-helpers.js";
import {
  buildScopedCacheKey,
  hashIdentity,
  readAiCache,
  writeAiCache,
} from "./request-helpers.js";

/**
 * Hono application for the agent service. Replaces the hand-rolled Node `http`
 * router (`http.ts`). Handlers return Fetch `Response` objects, which also lets
 * AI SDK's `toUIMessageStreamResponse()` be returned directly for the chat
 * endpoint (added in a later phase).
 *
 * Built behind a factory so tests can inject fakes and exercise routes via
 * `app.request()` without binding a port.
 */

type Variables = { requestId: string };

export type AgentApp = Hono<{ Variables: Variables }>;

type AgentContext = Context<{ Variables: Variables }>;
type ErrorStatus = 400 | 401 | 403 | 404 | 413 | 429 | 500 | 503 | 504;

export type ChatModelConfig = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

export type CreateAgentAppOptions = {
  config: AgentConfig;
  now?: () => Date;
  uptimeSeconds?: () => number;
  redisReady?: () => Promise<RedisReadyResult>;
  replayStore?: AgentReplayStore;
  createRequestId?: () => string;
  rateLimitStore?: RateLimitRedis;
  aiCacheStore?: AiCacheStore;
  richTextPolishProvider?: RichTextPolishProvider;
  resumeHelperProvider?: ResumeHelperProvider;
  sessionStore?: AgentSessionStore;
  createResumeReader?: (args: {
    userId: string;
    resumeId: string | null;
  }) => ResumeReader;
  resolveChatModel?: (modelConfig?: ChatModelConfig) => LanguageModel | null;
  /** Injectable for tests; forwarded to the chat runtime's streamText. */
  streamTextImpl?: StreamAgentChatOptions["streamTextImpl"];
};

export function createAgentApp(options: CreateAgentAppOptions): AgentApp {
  const {
    config,
    now = () => new Date(),
    uptimeSeconds = () => Math.floor(process.uptime()),
    redisReady = async () => ({ ok: true }),
    replayStore,
    createRequestId = () => `req_${randomUUID()}`,
    rateLimitStore,
    aiCacheStore,
    richTextPolishProvider,
    resumeHelperProvider,
    sessionStore,
    createResumeReader = (args) => createDrizzleResumeReader(args),
    resolveChatModel = (modelConfig) =>
      defaultResolveChatModel(config, modelConfig),
    streamTextImpl,
  } = options;

  const app = new Hono<{ Variables: Variables }>();

  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId =
      incoming && incoming.trim() !== "" ? incoming : createRequestId();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await next();
  });

  app.use(
    "/v1/*",
    cors({
      origin: (origin: string) =>
        origin && config.corsOrigins.includes(origin) ? origin : null,
      allowMethods: ["POST", "GET", "OPTIONS"],
      allowHeaders: ["authorization", "content-type", "accept", "x-request-id"],
      maxAge: 600,
      credentials: false,
    }),
  );

  const sendError = (
    c: AgentContext,
    status: ErrorStatus,
    body: {
      error: AgentErrorCode;
      message: string;
      dependency?: string;
      retryAfterSeconds?: number;
    },
  ) =>
    c.json(
      createErrorEnvelope({ ...body, requestId: c.get("requestId") }),
      status,
    );

  const enforceRateLimit = async (
    c: AgentContext,
    scope: Parameters<typeof checkRateLimit>[0]["scope"],
    userId: string,
    message: string,
  ): Promise<Response | null> => {
    if (!rateLimitStore) return null;
    try {
      const rateLimit = await checkRateLimit({
        redis: rateLimitStore,
        scope,
        identityHash: hashIdentity(userId),
        limit: config.rateLimitMaxRequests,
        windowSeconds: config.rateLimitWindowSeconds,
        now: now(),
      });
      if (!rateLimit.allowed) {
        return sendError(c, 429, {
          error: "rate_limited",
          message,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        });
      }
      return null;
    } catch {
      return sendError(c, 503, {
        error: "dependency_unavailable",
        message: "Rate limit store is unavailable",
        dependency: "redis",
      });
    }
  };

  const sendProviderError = (c: AgentContext, error: unknown): Response => {
    if (error instanceof RichTextPolishProviderError) {
      return sendError(c, error.code === "provider_timeout" ? 504 : 503, {
        error: error.code,
        message: error.message,
        dependency: error.code === "dependency_unavailable" ? "provider" : undefined,
      });
    }
    return sendError(c, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : "Internal error",
    });
  };

  app.get("/health", (c) =>
    c.json(statusBody("ok", config, now, uptimeSeconds)),
  );

  app.get("/ready", async (c) => {
    const redis = await redisReady();
    if (!redis.ok) {
      return sendError(c, 503, {
        error: "dependency_unavailable",
        message: redis.message,
        dependency: "redis",
      });
    }
    return c.json(statusBody("ready", config, now, uptimeSeconds));
  });

  app.get("/v1/session", async (c) => {
    const auth = await authenticateAgentRequest({
      authorizationHeader: c.req.header("authorization"),
      expectedScope: "agent:session",
      config,
      replayStore,
      now: now(),
    });
    if (!auth.ok) {
      return sendError(c, auth.statusCode, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }
    return c.json({
      status: "ok",
      subject: auth.session.userId,
      resumeId: auth.session.resumeId ?? null,
      scope: auth.session.scope,
      expiresAt: auth.session.expiresAt.toISOString(),
      requestId: c.get("requestId"),
    });
  });

  app.post("/v1/rich-text/polish", async (c) => {
    const auth = await authenticateAgentRequest({
      authorizationHeader: c.req.header("authorization"),
      expectedScope: "rich_text:polish",
      config,
      replayStore,
      now: now(),
    });
    if (!auth.ok) {
      return sendError(c, auth.statusCode, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }

    const body = await readJsonBody(c);
    if (!body.ok) {
      return sendError(c, 400, { error: "bad_request", message: body.message });
    }

    const validation = validateRichTextPolishRequest(body.value);
    if (!validation.ok) {
      return sendError(c, validation.statusCode, {
        error: validation.error,
        message: validation.message,
      });
    }

    if (auth.session.resumeId !== validation.request.resumeId) {
      return sendError(c, 403, {
        error: "forbidden",
        message: "Token resumeId does not match request resumeId",
      });
    }

    if (!richTextPolishProvider) {
      return sendError(c, 503, {
        error: "dependency_unavailable",
        message: "Rich text polish provider is not configured",
        dependency: "provider",
      });
    }

    const cacheKey = buildScopedCacheKey({
      scope: "rich_text:polish",
      session: auth.session,
      resumeId: validation.request.resumeId,
      config,
      input: validation.request,
    });
    const cached = await readAiCache<RichTextPolishRunResult>(aiCacheStore, cacheKey);
    if (cached) {
      return c.json({
        status: "ok",
        requestId: c.get("requestId"),
        result: cached.value.result,
        usage: cached.value.usage,
        cached: true,
        cachedAt: cached.createdAt,
      });
    }

    const limited = await enforceRateLimit(c, "rich_text:polish", auth.session.userId, "Too many rich text polish requests");
    if (limited) return limited;

    try {
      const polished = await polishRichText({
        request: validation.request,
        provider: richTextPolishProvider,
        session: auth.session,
        requestId: c.get("requestId"),
      });
      await writeAiCache(aiCacheStore, cacheKey, polished, "rich_text:polish", now);
      return c.json({
        status: "ok",
        requestId: c.get("requestId"),
        result: polished.result,
        usage: polished.usage,
      });
    } catch (error) {
      return sendProviderError(c, error);
    }
  });

  app.post("/v1/resume/helpers/:helperId", async (c) => {
    const helperId = c.req.param("helperId");
    const auth = await authenticateAgentRequest({
      authorizationHeader: c.req.header("authorization"),
      expectedScope: "resume:helper",
      config,
      replayStore,
      now: now(),
    });
    if (!auth.ok) {
      return sendError(c, auth.statusCode, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }

    const body = await readJsonBody(c);
    if (!body.ok) {
      return sendError(c, 400, { error: "bad_request", message: body.message });
    }

    const validation = validateResumeHelperRequest(helperId, body.value);
    if (!validation.ok) {
      return sendError(c, validation.statusCode, {
        error: validation.error,
        message: validation.message,
      });
    }

    if (auth.session.resumeId !== validation.request.resumeId) {
      return sendError(c, 403, {
        error: "forbidden",
        message: "Token resumeId does not match request resumeId",
      });
    }

    if (!resumeHelperProvider) {
      return sendError(c, 503, {
        error: "dependency_unavailable",
        message: "Resume helper provider is not configured",
        dependency: "provider",
      });
    }

    const cacheKey = buildScopedCacheKey({
      scope: "resume:helper",
      session: auth.session,
      resumeId: validation.request.resumeId,
      config,
      input: validation.request,
    });
    const cached = await readAiCache<ResumeHelperCacheValue>(aiCacheStore, cacheKey);
    if (cached) {
      return c.json({
        status: "ok",
        requestId: c.get("requestId"),
        helperId: cached.value.helperId,
        result: cached.value.result,
        usage: cached.value.usage,
        cached: true,
        cachedAt: cached.createdAt,
      });
    }

    const limited = await enforceRateLimit(c, "resume:helper", auth.session.userId, "Too many resume helper requests");
    if (limited) return limited;

    const prompt = buildResumeHelperPrompt({
      ...validation.request,
      requestId: c.get("requestId"),
    });

    try {
      const providerResult = await resumeHelperProvider.run({
        request: validation.request,
        prompt,
        session: auth.session,
        requestId: c.get("requestId"),
      });
      const parsed = parseResumeHelperProviderResponse(providerResult.content);
      if (!parsed.ok) {
        return sendError(c, 503, {
          error: "dependency_unavailable",
          message: parsed.message,
          dependency: "provider",
        });
      }
      const cacheValue: ResumeHelperCacheValue = {
        helperId: validation.request.helperId,
        result: parsed.result,
        usage: providerResult.usage,
      };
      await writeAiCache(aiCacheStore, cacheKey, cacheValue, "resume:helper", now);
      return c.json({
        status: "ok",
        requestId: c.get("requestId"),
        helperId: validation.request.helperId,
        result: parsed.result,
        usage: providerResult.usage,
      });
    } catch (error) {
      return sendProviderError(c, error);
    }
  });

  app.post("/v1/agent/session", async (c) => {
    const auth = await authenticateAgentRequest({
      authorizationHeader: c.req.header("authorization"),
      expectedScope: "agent:session",
      config,
      replayStore,
      now: now(),
    });
    if (!auth.ok) {
      return sendError(c, auth.statusCode, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }

    const body = await readJsonBody(c);
    if (!body.ok) {
      return sendError(c, 400, { error: "bad_request", message: body.message });
    }
    const parsed = SessionBodySchema.safeParse(body.value);
    if (!parsed.success) {
      return sendError(c, 400, { error: "bad_request", message: "Invalid session request" });
    }

    const resumeId = parsed.data.resumeId ?? auth.session.resumeId ?? null;
    if (auth.session.resumeId && resumeId && auth.session.resumeId !== resumeId) {
      return sendError(c, 403, {
        error: "forbidden",
        message: "Token resumeId does not match request resumeId",
      });
    }
    const mode: AgentResumeSessionMode =
      parsed.data.mode ?? (resumeId ? "optimize_existing" : "create_from_zero");
    const threadId = parsed.data.threadId ?? resumeId ?? "create_from_zero";
    const context: AgentRunSessionContext = {
      sessionId: deriveAgentSessionId({ resumeId, userId: auth.session.userId, threadId }),
      threadId,
      resumeId,
      mode,
      workflowId: null,
      resumeTitle: parsed.data.resumeTitle ?? "简历会话",
    };

    let snapshot = sessionStore
      ? await sessionStore.loadSnapshot({ session: auth.session, context })
      : null;
    if (!snapshot) {
      snapshot = createInitialAgentSessionSnapshot({
        context,
        userId: auth.session.userId,
        now: now().toISOString(),
      });
      if (sessionStore) {
        await sessionStore.appendEvents({ session: auth.session, context, snapshot, events: [] });
      }
    }

    return c.json({
      status: "ok",
      requestId: c.get("requestId"),
      sessionId: context.sessionId,
      mode,
      preview: snapshot.workspace.draftResume,
    });
  });

  app.post("/v1/agent/chat", async (c) => {
    const auth = await authenticateAgentRequest({
      authorizationHeader: c.req.header("authorization"),
      expectedScope: "agent:chat",
      config,
      replayStore,
      now: now(),
    });
    if (!auth.ok) {
      return sendError(c, auth.statusCode, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }

    const body = await readJsonBody(c);
    if (!body.ok) {
      return sendError(c, 400, { error: "bad_request", message: body.message });
    }
    const parsed = ChatBodySchema.safeParse(body.value);
    if (!parsed.success) {
      return sendError(c, 400, { error: "bad_request", message: "Invalid chat request" });
    }

    const model = resolveChatModel(parsed.data.modelConfig);
    if (!model) {
      return sendError(c, 503, {
        error: "dependency_unavailable",
        message: "Agent model is not configured",
        dependency: "provider",
      });
    }

    const session = auth.session;
    const resumeId = session.resumeId ?? null;
    const mode: AgentResumeSessionMode =
      parsed.data.mode ?? (resumeId ? "optimize_existing" : "create_from_zero");
    const preview = createPreview({ resumeId });
    const readResume = createResumeReader({ userId: session.userId, resumeId });
    const sessionId = parsed.data.sessionId ?? null;
    const requestId = c.get("requestId");

    const limited = await enforceRateLimit(c, "agent:chat", session.userId, "Too many agent chat requests");
    if (limited) return limited;

    return streamAgentChat({
      model,
      mode,
      messages: parsed.data.messages as UIMessage[],
      preview,
      readResume,
      telemetry: config.langfuse.enabled
        ? { isEnabled: true, functionId: "agent.chat", metadata: { requestId, mode } }
        : undefined,
      ...(streamTextImpl ? { streamTextImpl } : {}),
      onFinish: async () => {
        if (!sessionStore || !sessionId) return;
        try {
          const context: AgentRunSessionContext = {
            sessionId,
            threadId: resumeId ?? "create_from_zero",
            resumeId,
            mode,
            workflowId: null,
            resumeTitle: preview.title,
          };
          const base =
            (await sessionStore.loadSnapshot({ session, context })) ??
            createInitialAgentSessionSnapshot({
              context,
              userId: session.userId,
              now: now().toISOString(),
            });
          const snapshot = withPreview(base, preview, requestId, now().toISOString());
          await sessionStore.appendEvents({ session, context, snapshot, events: [] });
        } catch {
          // Persistence is best-effort; never fail the stream on a write error.
        }
      },
    });
  });

  app.notFound((c) =>
    sendError(c, 404, { error: "not_found", message: "Route not found" }),
  );

  app.onError((error, c) =>
    sendError(c, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : "Internal error",
    }),
  );

  return app;
}

function statusBody(
  status: "ok" | "ready",
  config: AgentConfig,
  now: () => Date,
  uptimeSeconds: () => number,
): Record<string, unknown> {
  return {
    status,
    service: config.serviceName,
    version: config.version,
    uptimeSeconds: uptimeSeconds(),
    timestamp: now().toISOString(),
    ...(status === "ready" ? { dependencies: { redis: "ready" } } : {}),
  };
}

type ResumeHelperCacheValue = {
  helperId: string;
  result: ResumeHelperResult;
  usage: ResumeHelperUsage;
};

async function readJsonBody(
  c: AgentContext,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false, message: "Request body must be valid JSON" };
  }
}

const ModelConfigSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string(),
  modelName: z.string(),
});

const SessionBodySchema = z.object({
  resumeId: z.string().nullable().optional(),
  threadId: z.string().optional(),
  mode: z.enum(["optimize_existing", "create_from_zero"]).optional(),
  resumeTitle: z.string().optional(),
});

const ChatBodySchema = z.object({
  sessionId: z.string().optional(),
  messages: z.array(z.unknown()),
  mode: z.enum(["optimize_existing", "create_from_zero"]).optional(),
  modelConfig: ModelConfigSchema.optional(),
});

function defaultResolveChatModel(
  config: AgentConfig,
  modelConfig?: ChatModelConfig,
): LanguageModel | null {
  if (modelConfig) return createChatModel(modelConfig);
  if (config.modelBaseUrl && config.modelApiKey && config.modelName) {
    return createChatModel({
      baseUrl: config.modelBaseUrl,
      apiKey: config.modelApiKey,
      modelName: config.modelName,
    });
  }
  return null;
}

/** Fold the current preview into a persistable session snapshot (draftResume +
 *  a single staged change-set carrying the operations the web apply step uses). */
function withPreview(
  base: AgentSessionSnapshot,
  preview: PreviewState,
  requestId: string,
  nowIso: string,
): AgentSessionSnapshot {
  const operations = [...preview.operations];
  const changeSets =
    operations.length === 0
      ? base.workspace.changeSets
      : [
          {
            id: `changeset_${safeId(requestId)}`,
            title: preview.title ? `${preview.title} · 待确认修改` : "待确认修改",
            summary: summarizeOps(operations),
            status: "staged" as const,
            operationIds: operations.map((operation) => operation.id),
            operations,
            createdAt: nowIso,
          },
        ];
  return {
    ...base,
    status: "active",
    workspace: {
      ...base.workspace,
      resumeId: preview.resumeId,
      draftResume: previewSnapshot(preview),
      changeSets,
      updatedAt: nowIso,
    },
    updatedAt: nowIso,
  };
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function summarizeOps(operations: ResumeOperation[]): string {
  const summaries = operations
    .map((operation) => operation.changeSummary.trim())
    .filter(Boolean);
  return summaries.length > 0
    ? summaries.join("；")
    : `包含 ${operations.length} 条修改`;
}
