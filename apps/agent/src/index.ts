import { serve } from "@hono/node-server";

import { loadConfig } from "./config.js";
import { createAgentApp } from "./server/app.js";
import { createRedisAiCacheStore } from "./ai-cache.js";
import {
  checkRedisReady,
  closeRedisConnection,
  createRedisConnection,
  createRedisReplayStore,
} from "./redis.js";
import { createPostgresAgentSessionStore } from "./session-store-postgres.js";
import { createDrizzleAgentSessionRepository } from "./db/agent-session-repository.js";
import { createOpenAICompatibleRichTextPolishProvider } from "./rich-text-polish.js";
import { createOpenAICompatibleResumeHelperProvider } from "./resume-helpers.js";
import { createAgentObservability } from "./observability.js";

const config = loadConfig();
const observability = createAgentObservability(config);
const redis = createRedisConnection(config, {
  onError: (error) => {
    log("error", "redis client error", { error: error.message });
  },
});

const app = createAgentApp({
  config,
  redisReady: () =>
    checkRedisReady(redis, { timeoutMs: config.redisConnectTimeoutMs }),
  replayStore: createRedisReplayStore(redis, {
    timeoutMs: config.redisConnectTimeoutMs,
  }),
  rateLimitStore: redis,
  aiCacheStore: createRedisAiCacheStore(redis),
  sessionStore: createPostgresAgentSessionStore(
    createDrizzleAgentSessionRepository(),
  ),
  richTextPolishProvider: createOpenAICompatibleRichTextPolishProvider(config),
  resumeHelperProvider: createOpenAICompatibleResumeHelperProvider(config),
});

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    log("info", "agent service listening", {
      host: config.host,
      port: info.port,
      service: config.serviceName,
      version: config.version,
    });
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown(signal);
  });
}

function shutdown(signal: NodeJS.Signals): void {
  log("info", "agent service shutting down", { signal });

  const timeout = setTimeout(() => {
    log("error", "agent service shutdown timed out", {
      timeoutMs: config.shutdownTimeoutMs,
    });
    process.exit(1);
  }, config.shutdownTimeoutMs);

  server.close((error?: Error) => {
    clearTimeout(timeout);

    if (error) {
      log("error", "agent service shutdown failed", { error: error.message });
      process.exit(1);
    }

    void Promise.allSettled([
      closeRedisConnection(redis),
      observability.shutdown(),
    ]).finally(() => {
      log("info", "agent service stopped", { signal });
      process.exit(0);
    });
  });
}

function log(
  level: "info" | "error",
  message: string,
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...fields,
  });

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}
