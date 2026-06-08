import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config";

describe("agent config", () => {
  it("uses local-development defaults when env is empty", () => {
    const config = loadConfig({});

    expect(config).toEqual({
      host: "0.0.0.0",
      port: 8787,
      serviceName: "intro-agent",
      version: "0.0.0-dev",
      nodeEnv: "development",
      shutdownTimeoutMs: 10_000,
      redisUrl: "redis://127.0.0.1:6379",
      redisConnectTimeoutMs: 1_000,
      rateLimitWindowSeconds: 60,
      rateLimitMaxRequests: 30,
      jwtIssuer: "intro-builder-web",
      jwtAudience: "intro-builder-agent",
      jwtSecret: undefined,
      jwtReplayTtlSeconds: 180,
      modelBaseUrl: undefined,
      modelApiKey: undefined,
      modelName: undefined,
      modelTimeoutMs: 20_000,
    });
  });

  it("accepts explicit env overrides", () => {
    const config = loadConfig({
      AGENT_HOST: "127.0.0.1",
      AGENT_PORT: "9001",
      AGENT_SERVICE_NAME: "intro-agent-preview",
      AGENT_VERSION: "2026.06.05",
      NODE_ENV: "production",
      AGENT_SHUTDOWN_TIMEOUT_MS: "2500",
      REDIS_URL: "redis://redis:6379",
      REDIS_CONNECT_TIMEOUT_MS: "1500",
      RATE_LIMIT_WINDOW_SECONDS: "120",
      RATE_LIMIT_MAX_REQUESTS: "10",
      AGENT_JWT_ISSUER: "intro-test-web",
      AGENT_JWT_AUDIENCE: "intro-test-agent",
      AGENT_JWT_SECRET: "test-secret",
      AGENT_JWT_REPLAY_TTL_SECONDS: "60",
      AGENT_MODEL_BASE_URL: "https://model.test/v1",
      AGENT_MODEL_API_KEY: "model-key",
      AGENT_MODEL_NAME: "gpt-test",
      AGENT_MODEL_TIMEOUT_MS: "30000",
    });

    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 9001,
      serviceName: "intro-agent-preview",
      version: "2026.06.05",
      nodeEnv: "production",
      shutdownTimeoutMs: 2500,
      redisUrl: "redis://redis:6379",
      redisConnectTimeoutMs: 1500,
      rateLimitWindowSeconds: 120,
      rateLimitMaxRequests: 10,
      jwtIssuer: "intro-test-web",
      jwtAudience: "intro-test-agent",
      jwtSecret: "test-secret",
      jwtReplayTtlSeconds: 60,
      modelBaseUrl: "https://model.test/v1",
      modelApiKey: "model-key",
      modelName: "gpt-test",
      modelTimeoutMs: 30000,
    });
  });

  it("fails fast for invalid ports", () => {
    expect(() => loadConfig({ AGENT_PORT: "not-a-port" })).toThrow(
      /AGENT_PORT must be an integer between 1 and 65535/,
    );

    expect(() => loadConfig({ AGENT_PORT: "70000" })).toThrow(
      /AGENT_PORT must be an integer between 1 and 65535/,
    );
  });

  it("fails fast for invalid stability settings", () => {
    expect(() => loadConfig({ REDIS_CONNECT_TIMEOUT_MS: "0" })).toThrow(
      /REDIS_CONNECT_TIMEOUT_MS must be an integer between 1 and 30000/,
    );

    expect(() => loadConfig({ RATE_LIMIT_WINDOW_SECONDS: "0" })).toThrow(
      /RATE_LIMIT_WINDOW_SECONDS must be an integer between 1 and 86400/,
    );

    expect(() => loadConfig({ RATE_LIMIT_MAX_REQUESTS: "0" })).toThrow(
      /RATE_LIMIT_MAX_REQUESTS must be an integer between 1 and 100000/,
    );

    expect(() => loadConfig({ AGENT_JWT_REPLAY_TTL_SECONDS: "0" })).toThrow(
      /AGENT_JWT_REPLAY_TTL_SECONDS must be an integer between 1 and 86400/,
    );

    expect(() => loadConfig({ AGENT_MODEL_TIMEOUT_MS: "0" })).toThrow(
      /AGENT_MODEL_TIMEOUT_MS must be an integer between 1 and 120000/,
    );
  });
});
