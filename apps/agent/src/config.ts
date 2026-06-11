export type AgentConfig = {
  host: string;
  port: number;
  serviceName: string;
  version: string;
  nodeEnv: string;
  shutdownTimeoutMs: number;
  redisUrl: string;
  redisConnectTimeoutMs: number;
  rateLimitWindowSeconds: number;
  rateLimitMaxRequests: number;
  jwtIssuer: string;
  jwtAudience: string;
  jwtSecret?: string;
  jwtReplayTtlSeconds: number;
  modelBaseUrl?: string;
  modelApiKey?: string;
  modelName?: string;
  modelTimeoutMs: number;
  langfuse: {
    enabled: boolean;
    publicKey?: string;
    secretKey?: string;
    baseUrl: string;
    environment: string;
    release: string;
    timeoutSeconds: number;
    sampleRate: number;
    captureRawPayloads: boolean;
  };
};

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AgentConfig {
  const serviceName = env.AGENT_SERVICE_NAME ?? "intro-agent";
  const version = env.AGENT_VERSION ?? "0.0.0-dev";
  const nodeEnv = env.NODE_ENV ?? "development";
  const langfusePublicKey = emptyToUndefined(env.LANGFUSE_PUBLIC_KEY);
  const langfuseSecretKey = emptyToUndefined(env.LANGFUSE_SECRET_KEY);
  const langfuseTracingRequested = parseBooleanEnv(
    env.LANGFUSE_TRACING_ENABLED,
    false,
  );

  return {
    host: env.AGENT_HOST ?? "0.0.0.0",
    port: parseIntegerEnv(env.AGENT_PORT, "AGENT_PORT", 8787, {
      min: 1,
      max: 65_535,
    }),
    serviceName,
    version,
    nodeEnv,
    shutdownTimeoutMs: parseIntegerEnv(
      env.AGENT_SHUTDOWN_TIMEOUT_MS,
      "AGENT_SHUTDOWN_TIMEOUT_MS",
      10_000,
      { min: 1, max: 120_000 },
    ),
    redisUrl: env.REDIS_URL ?? "redis://127.0.0.1:6379",
    redisConnectTimeoutMs: parseIntegerEnv(
      env.REDIS_CONNECT_TIMEOUT_MS,
      "REDIS_CONNECT_TIMEOUT_MS",
      1_000,
      { min: 1, max: 30_000 },
    ),
    rateLimitWindowSeconds: parseIntegerEnv(
      env.RATE_LIMIT_WINDOW_SECONDS,
      "RATE_LIMIT_WINDOW_SECONDS",
      60,
      { min: 1, max: 86_400 },
    ),
    rateLimitMaxRequests: parseIntegerEnv(
      env.RATE_LIMIT_MAX_REQUESTS,
      "RATE_LIMIT_MAX_REQUESTS",
      30,
      { min: 1, max: 100_000 },
    ),
    jwtIssuer: env.AGENT_JWT_ISSUER ?? "intro-builder-web",
    jwtAudience: env.AGENT_JWT_AUDIENCE ?? "intro-builder-agent",
    jwtSecret: env.AGENT_JWT_SECRET,
    jwtReplayTtlSeconds: parseIntegerEnv(
      env.AGENT_JWT_REPLAY_TTL_SECONDS,
      "AGENT_JWT_REPLAY_TTL_SECONDS",
      180,
      { min: 1, max: 86_400 },
    ),
    modelBaseUrl: env.AGENT_MODEL_BASE_URL,
    modelApiKey: env.AGENT_MODEL_API_KEY,
    modelName: env.AGENT_MODEL_NAME,
    modelTimeoutMs: parseIntegerEnv(
      env.AGENT_MODEL_TIMEOUT_MS,
      "AGENT_MODEL_TIMEOUT_MS",
      20_000,
      { min: 1, max: 120_000 },
    ),
    langfuse: {
      enabled: langfuseTracingRequested && Boolean(langfusePublicKey && langfuseSecretKey),
      publicKey: langfusePublicKey,
      secretKey: langfuseSecretKey,
      baseUrl: env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
      environment: env.LANGFUSE_TRACING_ENVIRONMENT ?? nodeEnv,
      release: env.LANGFUSE_RELEASE ?? version,
      timeoutSeconds: parseIntegerEnv(env.LANGFUSE_TIMEOUT, "LANGFUSE_TIMEOUT", 5, {
        min: 1,
        max: 120,
      }),
      sampleRate: parseNumberEnv(
        env.LANGFUSE_SAMPLE_RATE,
        "LANGFUSE_SAMPLE_RATE",
        1,
        { min: 0, max: 1 },
      ),
      captureRawPayloads: parseBooleanEnv(env.LANGFUSE_CAPTURE_RAW_PAYLOADS, false),
    },
  };
}

function parseIntegerEnv(
  value: string | undefined,
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  const isValid =
    Number.isInteger(parsed) && parsed >= bounds.min && parsed <= bounds.max;

  if (!isValid) {
    throw new Error(`${name} must be an integer between ${bounds.min} and ${bounds.max}`);
  }

  return parsed;
}

function parseNumberEnv(
  value: string | undefined,
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  const isValid =
    Number.isFinite(parsed) && parsed >= bounds.min && parsed <= bounds.max;

  if (!isValid) {
    throw new Error(`${name} must be a number between ${bounds.min} and ${bounds.max}`);
  }

  return parsed;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}
