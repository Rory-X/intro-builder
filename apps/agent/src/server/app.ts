import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import {
  authenticateAgentRequest,
  type AgentReplayStore,
} from "../auth.js";
import type { AgentConfig } from "../config.js";
import { createErrorEnvelope, type AgentErrorCode } from "../errors.js";
import type { RedisReadyResult } from "../redis.js";

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
type ErrorStatus = 400 | 401 | 403 | 404 | 429 | 500 | 503;

export type CreateAgentAppOptions = {
  config: AgentConfig;
  now?: () => Date;
  uptimeSeconds?: () => number;
  redisReady?: () => Promise<RedisReadyResult>;
  replayStore?: AgentReplayStore;
  createRequestId?: () => string;
};

export function createAgentApp(options: CreateAgentAppOptions): AgentApp {
  const {
    config,
    now = () => new Date(),
    uptimeSeconds = () => Math.floor(process.uptime()),
    redisReady = async () => ({ ok: true }),
    replayStore,
    createRequestId = () => `req_${randomUUID()}`,
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
