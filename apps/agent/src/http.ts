import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import {
  authenticateAgentRequest,
  type AgentReplayStore,
  type AuthenticatedAgentSession,
} from "./auth.js";
import type { AgentConfig } from "./config.js";
import { createErrorEnvelope } from "./errors.js";
import { checkRateLimit, type RateLimitRedis } from "./rate-limit.js";
import type { RedisReadyResult } from "./redis.js";
import {
  buildRichTextPolishPrompt,
  parsePolishProviderResponse,
  RichTextPolishProviderError,
  validateRichTextPolishRequest,
  type RichTextPolishProvider,
} from "./rich-text-polish.js";

export type CreateAgentServerOptions = {
  config: AgentConfig;
  now?: () => Date;
  uptimeSeconds?: () => number;
  redisReady?: () => Promise<RedisReadyResult>;
  replayStore?: AgentReplayStore;
  rateLimitStore?: RateLimitRedis;
  richTextPolishProvider?: RichTextPolishProvider;
  createRequestId?: () => string;
};

type HealthStatus = "ok" | "ready";
type RequestContext = {
  requestId: string;
};

export function createAgentServer({
  config,
  now = () => new Date(),
  uptimeSeconds = () => Math.floor(process.uptime()),
  redisReady = async () => ({ ok: true }),
  replayStore,
  rateLimitStore,
  richTextPolishProvider,
  createRequestId = defaultCreateRequestId,
}: CreateAgentServerOptions): Server {
  return createServer((request, response) => {
    void routeRequest(
      request,
      response,
      config,
      now,
      uptimeSeconds,
      redisReady,
      replayStore,
      rateLimitStore,
      richTextPolishProvider,
      createRequestId,
    ).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }

      const context = {
        requestId: resolveRequestId(request, createRequestId),
      };
      sendError(response, 500, context, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Internal error",
      });
    });
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: AgentConfig,
  now: () => Date,
  uptimeSeconds: () => number,
  redisReady: () => Promise<RedisReadyResult>,
  replayStore: AgentReplayStore | undefined,
  rateLimitStore: RateLimitRedis | undefined,
  richTextPolishProvider: RichTextPolishProvider | undefined,
  createRequestId: () => string,
): Promise<void> {
  const context = {
    requestId: resolveRequestId(request, createRequestId),
  };
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://agent.local");

  if (url.pathname === "/health") {
    if (method !== "GET") return methodNotAllowed(response, context);

    return sendStatus(response, "ok", config, now, uptimeSeconds, context);
  }

  if (url.pathname === "/ready") {
    if (method !== "GET") return methodNotAllowed(response, context);

    const redis = await redisReady();
    if (!redis.ok) {
      return sendError(response, 503, context, {
        error: "dependency_unavailable",
        message: redis.message,
        dependency: "redis",
      });
    }

    return sendStatus(response, "ready", config, now, uptimeSeconds, context);
  }

  if (url.pathname === "/v1/session") {
    if (method !== "GET") return methodNotAllowed(response, context);

    const auth = await authenticateAgentRequest({
      authorizationHeader: headerValue(request.headers.authorization),
      expectedScope: "agent:session",
      config,
      replayStore,
      now: now(),
    });

    if (!auth.ok) {
      return sendError(response, auth.statusCode, context, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }

    return sendAgentSession(response, auth.session, context);
  }

  if (url.pathname === "/v1/rich-text/polish") {
    if (method !== "POST") return methodNotAllowed(response, context, "POST");

    const auth = await authenticateAgentRequest({
      authorizationHeader: headerValue(request.headers.authorization),
      expectedScope: "rich_text:polish",
      config,
      replayStore,
      now: now(),
    });

    if (!auth.ok) {
      return sendError(response, auth.statusCode, context, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return sendError(response, 400, context, {
        error: "bad_request",
        message: body.message,
      });
    }

    const validation = validateRichTextPolishRequest(body.value);
    if (!validation.ok) {
      return sendError(response, validation.statusCode, context, {
        error: validation.error,
        message: validation.message,
      });
    }

    if (auth.session.resumeId !== validation.request.resumeId) {
      return sendError(response, 403, context, {
        error: "forbidden",
        message: "Token resumeId does not match request resumeId",
      });
    }

    if (!richTextPolishProvider) {
      return sendError(response, 503, context, {
        error: "dependency_unavailable",
        message: "Rich text polish provider is not configured",
        dependency: "provider",
      });
    }

    if (rateLimitStore) {
      try {
        const rateLimit = await checkRateLimit({
          redis: rateLimitStore,
          scope: "rich_text:polish",
          identityHash: hashIdentity(auth.session.userId),
          limit: config.rateLimitMaxRequests,
          windowSeconds: config.rateLimitWindowSeconds,
          now: now(),
        });
        if (!rateLimit.allowed) {
          return sendError(response, 429, context, {
            error: "rate_limited",
            message: "Too many rich text polish requests",
            retryAfterSeconds: rateLimit.retryAfterSeconds,
          });
        }
      } catch {
        return sendError(response, 503, context, {
          error: "dependency_unavailable",
          message: "Rate limit store is unavailable",
          dependency: "redis",
        });
      }
    }

    const prompt = buildRichTextPolishPrompt({
      ...validation.request,
      requestId: context.requestId,
    });

    try {
      const providerResult = await richTextPolishProvider.polish({
        request: validation.request,
        prompt,
        session: auth.session,
        requestId: context.requestId,
      });
      const parsed = parsePolishProviderResponse(providerResult.content);
      if (!parsed.ok) {
        return sendError(response, 503, context, {
          error: "dependency_unavailable",
          message: parsed.message,
          dependency: "provider",
        });
      }

      return sendJson(
        response,
        200,
        {
          status: "ok",
          requestId: context.requestId,
          result: parsed.result,
          usage: providerResult.usage,
        },
        context,
      );
    } catch (error) {
      if (error instanceof RichTextPolishProviderError) {
        return sendError(response, error.code === "provider_timeout" ? 504 : 503, context, {
          error: error.code,
          message: error.message,
          dependency: error.code === "dependency_unavailable" ? "provider" : undefined,
        });
      }
      return sendError(response, 500, context, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Internal error",
      });
    }
  }

  return sendError(response, 404, context, {
    error: "not_found",
    message: "Route not found",
  });
}

function sendStatus(
  response: ServerResponse,
  status: HealthStatus,
  config: AgentConfig,
  now: () => Date,
  uptimeSeconds: () => number,
  context: RequestContext,
): void {
  sendJson(
    response,
    200,
    {
      status,
      service: config.serviceName,
      version: config.version,
      uptimeSeconds: uptimeSeconds(),
      timestamp: now().toISOString(),
      ...(status === "ready"
        ? {
            dependencies: {
              redis: "ready",
            },
          }
        : {}),
    },
    context,
  );
}

function sendAgentSession(
  response: ServerResponse,
  session: AuthenticatedAgentSession,
  context: RequestContext,
): void {
  sendJson(
    response,
    200,
    {
      status: "ok",
      subject: session.userId,
      resumeId: session.resumeId ?? null,
      scope: session.scope,
      expiresAt: session.expiresAt.toISOString(),
      requestId: context.requestId,
    },
    context,
  );
}

function methodNotAllowed(
  response: ServerResponse,
  context: RequestContext,
  allow = "GET",
): void {
  response.setHeader("Allow", allow);
  sendError(response, 405, context, {
    error: "method_not_allowed",
    message: "Method not allowed",
  });
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  context: RequestContext,
  error: {
    error: Parameters<typeof createErrorEnvelope>[0]["error"];
    message: string;
    dependency?: string;
    retryAfterSeconds?: number;
  },
): void {
  sendJson(
    response,
    statusCode,
    createErrorEnvelope({
      ...error,
      requestId: context.requestId,
    }),
    context,
  );
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  context: RequestContext,
): void {
  const payload = JSON.stringify(body);

  response.statusCode = statusCode;
  response.setHeader("X-Request-Id", context.requestId);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload);
}

function resolveRequestId(
  request: IncomingMessage,
  createRequestId: () => string,
): string {
  const incoming = request.headers["x-request-id"];
  const requestId = Array.isArray(incoming) ? incoming[0] : incoming;

  if (requestId && requestId.trim() !== "") {
    return requestId;
  }

  return createRequestId();
}

function headerValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function defaultCreateRequestId(): string {
  return `req_${randomUUID()}`;
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return { ok: false, message: "Request body is required" };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, message: "Request body must be valid JSON" };
  }
}

function hashIdentity(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}
