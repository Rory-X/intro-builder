import { createClient } from "redis";

import type { AgentConfig } from "./config.js";

export type RedisReadyConnection = {
  isOpen?: boolean;
  isReady?: boolean;
  connect: () => Promise<unknown>;
  ping: () => Promise<string>;
  quit?: () => Promise<unknown>;
  disconnect?: () => void;
};

export type RedisConnection = RedisReadyConnection & {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  set: (
    key: string,
    value: string,
    options: { NX: true; EX: number },
  ) => Promise<"OK" | null>;
};

export type RedisReadyResult =
  | { ok: true }
  | { ok: false; message: string };

type CheckRedisReadyOptions = {
  timeoutMs?: number;
};

type CreateRedisConnectionOptions = {
  onError?: (error: Error) => void;
};

type CreateRedisReplayStoreOptions = {
  timeoutMs?: number;
};

const pendingConnections = new WeakMap<RedisReadyConnection, Promise<void>>();

export function createRedisConnection(
  config: AgentConfig,
  options: CreateRedisConnectionOptions = {},
): RedisConnection {
  const client = createClient({
    url: config.redisUrl,
    socket: {
      connectTimeout: config.redisConnectTimeoutMs,
      reconnectStrategy: (retries) => Math.min(retries * 50, 1_000),
    },
  });

  client.on("error", (error) => {
    options.onError?.(error);
  });

  return client as unknown as RedisConnection;
}

export function createRedisReplayStore(
  redis: RedisConnection,
  options: CreateRedisReplayStoreOptions = {},
): Pick<RedisConnection, "set"> {
  return {
    async set(key, value, setOptions) {
      await ensureRedisConnected(redis, options.timeoutMs ?? 1_000);
      return redis.set(key, value, setOptions);
    },
  };
}

export async function checkRedisReady(
  redis: RedisReadyConnection,
  options: CheckRedisReadyOptions = {},
): Promise<RedisReadyResult> {
  try {
    await ensureRedisConnected(redis, options.timeoutMs ?? 1_000);

    const pong = await redis.ping();
    if (String(pong).toUpperCase() !== "PONG") {
      return { ok: false, message: `Redis ping returned ${pong}` };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, message: `Redis unavailable: ${errorMessage(error)}` };
  }
}

export async function closeRedisConnection(
  redis: RedisReadyConnection,
): Promise<void> {
  try {
    if (redis.isOpen && redis.quit) {
      await redis.quit();
      return;
    }
  } catch {
    // Fall through to disconnect; shutdown should not hang on Redis cleanup.
  }

  redis.disconnect?.();
}

async function ensureRedisConnected(
  redis: RedisReadyConnection,
  timeoutMs: number,
): Promise<void> {
  if (redis.isReady || redis.isOpen) return;

  const pending = pendingConnections.get(redis);
  if (pending) return withTimeout(redis, pending, timeoutMs);

  const connection = Promise.resolve(redis.connect()).then(() => undefined);
  connection
    .catch(() => undefined)
    .finally(() => {
      pendingConnections.delete(redis);
    });

  pendingConnections.set(redis, connection);
  return withTimeout(redis, connection, timeoutMs);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function withTimeout(
  redis: RedisReadyConnection,
  operation: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      pendingConnections.delete(redis);
      redis.disconnect?.();
      reject(new Error(`Redis readiness timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
