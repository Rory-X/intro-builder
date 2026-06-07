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
};

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AgentConfig {
  return {
    host: env.AGENT_HOST ?? "0.0.0.0",
    port: parseIntegerEnv(env.AGENT_PORT, "AGENT_PORT", 8787, {
      min: 1,
      max: 65_535,
    }),
    serviceName: env.AGENT_SERVICE_NAME ?? "intro-agent",
    version: env.AGENT_VERSION ?? "0.0.0-dev",
    nodeEnv: env.NODE_ENV ?? "development",
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
