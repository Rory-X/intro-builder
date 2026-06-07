import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type { AgentConfig } from "./config.js";
import { createErrorEnvelope } from "./errors.js";
import type { RedisReadyResult } from "./redis.js";

export type CreateAgentServerOptions = {
  config: AgentConfig;
  now?: () => Date;
  uptimeSeconds?: () => number;
  redisReady?: () => Promise<RedisReadyResult>;
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

function methodNotAllowed(
  response: ServerResponse,
  context: RequestContext,
): void {
  response.setHeader("Allow", "GET");
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

function defaultCreateRequestId(): string {
  return `req_${randomUUID()}`;
}
