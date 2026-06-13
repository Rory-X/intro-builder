import { loadConfig } from "./config.js";
import { createAgentServer } from "./http.js";
import { createRedisAiCacheStore } from "./ai-cache.js";
import {
  checkRedisReady,
  closeRedisConnection,
  createRedisConnection,
  createRedisReplayStore,
} from "./redis.js";
import { createOpenAICompatibleRichTextPolishProvider } from "./rich-text-polish.js";
import { createOpenAICompatibleResumeHelperProvider } from "./resume-helpers.js";
import { createOpenAICompatibleAgentMessageProvider } from "./agent-messages.js";
import { createAgentObservability } from "./observability.js";
import { createDevelopmentAgentMessageProvider } from "./workflows/dev-preview-provider.js";

const config = loadConfig();
const observability = createAgentObservability(config);
const redis = createRedisConnection(config, {
  onError: (error) => {
    log("error", "redis client error", { error: error.message });
  },
});
const server = createAgentServer({
  config,
  redisReady: () =>
    checkRedisReady(redis, { timeoutMs: config.redisConnectTimeoutMs }),
  replayStore: createRedisReplayStore(redis, {
    timeoutMs: config.redisConnectTimeoutMs,
  }),
  rateLimitStore: redis,
  aiCacheStore: createRedisAiCacheStore(redis),
  richTextPolishProvider: createOpenAICompatibleRichTextPolishProvider(config),
  resumeHelperProvider: createOpenAICompatibleResumeHelperProvider(config),
  agentMessageProvider:
    createOpenAICompatibleAgentMessageProvider(config) ??
    createDevelopmentAgentMessageProvider(config),
  observability,
});

server.listen(config.port, config.host, () => {
  log("info", "agent service listening", {
    host: config.host,
    port: config.port,
    service: config.serviceName,
    version: config.version,
  });
});

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
