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
      corsOrigins: [],
      modelBaseUrl: undefined,
      modelApiKey: undefined,
      modelName: undefined,
      modelTimeoutMs: 90_000,
      langfuse: {
        enabled: false,
        publicKey: undefined,
        secretKey: undefined,
        baseUrl: "https://cloud.langfuse.com",
        environment: "development",
        release: "0.0.0-dev",
        timeoutSeconds: 5,
        sampleRate: 1,
        captureRawPayloads: false,
        promptManagementEnabled: false,
        agentMessagePromptName: "intro-builder/agent-message",
        promptLabel: "production",
        promptCacheTtlSeconds: 300,
        promptFetchTimeoutMs: 5000,
        agentMessageDatasetName: undefined,
        datasetFetchItemsPageSize: 50,
      },
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
      AGENT_CORS_ORIGINS:
        "https://intro-builder.vercel.app, http://localhost:3000",
      AGENT_MODEL_BASE_URL: "https://model.test/v1",
      AGENT_MODEL_API_KEY: "model-key",
      AGENT_MODEL_NAME: "gpt-test",
      AGENT_MODEL_TIMEOUT_MS: "30000",
      LANGFUSE_TRACING_ENABLED: "true",
      LANGFUSE_PUBLIC_KEY: "pk_test",
      LANGFUSE_SECRET_KEY: "sk_test",
      LANGFUSE_BASE_URL: "https://langfuse.test",
      LANGFUSE_TRACING_ENVIRONMENT: "preview",
      LANGFUSE_RELEASE: "2026.06.05-agent",
      LANGFUSE_TIMEOUT: "8",
      LANGFUSE_SAMPLE_RATE: "0.25",
      LANGFUSE_CAPTURE_RAW_PAYLOADS: "true",
      LANGFUSE_PROMPT_MANAGEMENT_ENABLED: "true",
      LANGFUSE_AGENT_MESSAGE_PROMPT_NAME: "intro-builder/agent-message-preview",
      LANGFUSE_PROMPT_LABEL: "staging",
      LANGFUSE_PROMPT_CACHE_TTL_SECONDS: "120",
      LANGFUSE_PROMPT_FETCH_TIMEOUT_MS: "3000",
      LANGFUSE_AGENT_MESSAGE_DATASET_NAME: "intro-builder/agent-message-contract",
      LANGFUSE_DATASET_FETCH_ITEMS_PAGE_SIZE: "25",
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
      corsOrigins: ["https://intro-builder.vercel.app", "http://localhost:3000"],
      modelBaseUrl: "https://model.test/v1",
      modelApiKey: "model-key",
      modelName: "gpt-test",
      modelTimeoutMs: 30000,
      langfuse: {
        enabled: true,
        publicKey: "pk_test",
        secretKey: "sk_test",
        baseUrl: "https://langfuse.test",
        environment: "preview",
        release: "2026.06.05-agent",
        timeoutSeconds: 8,
        sampleRate: 0.25,
        captureRawPayloads: true,
        promptManagementEnabled: true,
        agentMessagePromptName: "intro-builder/agent-message-preview",
        promptLabel: "staging",
        promptCacheTtlSeconds: 120,
        promptFetchTimeoutMs: 3000,
        agentMessageDatasetName: "intro-builder/agent-message-contract",
        datasetFetchItemsPageSize: 25,
      },
    });
  });

  it("keeps Langfuse disabled when credentials are missing", () => {
    expect(
      loadConfig({
        LANGFUSE_TRACING_ENABLED: "true",
        LANGFUSE_PUBLIC_KEY: "pk_test",
      }).langfuse,
    ).toMatchObject({
      enabled: false,
      publicKey: "pk_test",
      secretKey: undefined,
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

    expect(() => loadConfig({ LANGFUSE_TIMEOUT: "0" })).toThrow(
      /LANGFUSE_TIMEOUT must be an integer between 1 and 120/,
    );

    expect(() => loadConfig({ LANGFUSE_SAMPLE_RATE: "-0.1" })).toThrow(
      /LANGFUSE_SAMPLE_RATE must be a number between 0 and 1/,
    );

    expect(() => loadConfig({ LANGFUSE_SAMPLE_RATE: "1.1" })).toThrow(
      /LANGFUSE_SAMPLE_RATE must be a number between 0 and 1/,
    );

    expect(() => loadConfig({ LANGFUSE_PROMPT_CACHE_TTL_SECONDS: "-1" })).toThrow(
      /LANGFUSE_PROMPT_CACHE_TTL_SECONDS must be an integer between 0 and 86400/,
    );

    expect(() => loadConfig({ LANGFUSE_PROMPT_FETCH_TIMEOUT_MS: "0" })).toThrow(
      /LANGFUSE_PROMPT_FETCH_TIMEOUT_MS must be an integer between 1 and 120000/,
    );

    expect(() => loadConfig({ LANGFUSE_DATASET_FETCH_ITEMS_PAGE_SIZE: "0" })).toThrow(
      /LANGFUSE_DATASET_FETCH_ITEMS_PAGE_SIZE must be an integer between 1 and 500/,
    );
  });
});
