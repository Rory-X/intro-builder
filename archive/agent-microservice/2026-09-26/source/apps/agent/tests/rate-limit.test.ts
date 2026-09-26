import { describe, expect, it } from "vitest";

import { checkRateLimit, type RateLimitRedis } from "../src/rate-limit";

describe("Redis rate limit primitive", () => {
  it("allows requests below the window limit and sets expiry on the first hit", async () => {
    const redis = new MemoryRateLimitRedis();
    const now = new Date("2026-06-07T00:00:05.000Z");

    const result = await checkRateLimit({
      redis,
      scope: "rich_text:polish",
      identityHash: "u_hash",
      limit: 2,
      windowSeconds: 60,
      now,
    });

    const windowStartSeconds = Math.floor(now.getTime() / 1000 / 60) * 60;
    expect(result).toEqual({
      allowed: true,
      count: 1,
      key: `rate:rich_text:polish:u_hash:${windowStartSeconds}`,
      limit: 2,
      remaining: 1,
      resetAt: new Date((windowStartSeconds + 60) * 1000),
    });
    expect(redis.expirations).toEqual([[result.key, 60]]);
  });

  it("blocks requests after the window limit is exceeded", async () => {
    const redis = new MemoryRateLimitRedis();
    const now = new Date("2026-06-07T00:00:05.000Z");

    await checkRateLimit({
      redis,
      scope: "agent:chat",
      identityHash: "u_hash",
      limit: 2,
      windowSeconds: 60,
      now,
    });
    await checkRateLimit({
      redis,
      scope: "agent:chat",
      identityHash: "u_hash",
      limit: 2,
      windowSeconds: 60,
      now,
    });
    const result = await checkRateLimit({
      redis,
      scope: "agent:chat",
      identityHash: "u_hash",
      limit: 2,
      windowSeconds: 60,
      now,
    });

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(3);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBe(55);
  });

  it("uses a fresh key when the next window starts", async () => {
    const redis = new MemoryRateLimitRedis();
    const firstWindow = new Date("2026-06-07T00:00:59.000Z");
    const secondWindow = new Date("2026-06-07T00:01:00.000Z");

    const first = await checkRateLimit({
      redis,
      scope: "rich_text:polish",
      identityHash: "u_hash",
      limit: 1,
      windowSeconds: 60,
      now: firstWindow,
    });
    const second = await checkRateLimit({
      redis,
      scope: "rich_text:polish",
      identityHash: "u_hash",
      limit: 1,
      windowSeconds: 60,
      now: secondWindow,
    });

    expect(first.key).not.toBe(second.key);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });
});

class MemoryRateLimitRedis implements RateLimitRedis {
  readonly expirations: Array<[key: string, seconds: number]> = [];
  private readonly counts = new Map<string, number>();

  async incr(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expirations.push([key, seconds]);
  }
}
