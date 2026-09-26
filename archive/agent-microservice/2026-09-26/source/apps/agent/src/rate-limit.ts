export type RateLimitRedis = {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

export type RateLimitOptions = {
  redis: RateLimitRedis;
  scope: string;
  identityHash: string;
  limit: number;
  windowSeconds: number;
  now?: Date;
};

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  key: string;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds?: number;
};

export async function checkRateLimit({
  redis,
  scope,
  identityHash,
  limit,
  windowSeconds,
  now = new Date(),
}: RateLimitOptions): Promise<RateLimitResult> {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const windowStartSeconds =
    Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const resetAtSeconds = windowStartSeconds + windowSeconds;
  const key = `rate:${scope}:${identityHash}:${windowStartSeconds}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  const allowed = count <= limit;
  const remaining = Math.max(limit - count, 0);

  return {
    allowed,
    count,
    key,
    limit,
    remaining,
    resetAt: new Date(resetAtSeconds * 1_000),
    ...(allowed
      ? {}
      : {
          retryAfterSeconds: Math.max(1, resetAtSeconds - nowSeconds),
        }),
  };
}
