import { describe, expect, it } from "vitest";

import {
  buildAiCacheKey,
  createRedisAiCacheStore,
  getAiCacheTtlSeconds,
  type AiCacheRedis,
} from "../src/ai-cache";

describe("AI result cache", () => {
  it("builds stable keys without exposing raw user or resume ids", () => {
    const first = buildAiCacheKey({
      scope: "rich_text:polish",
      userId: "user_123",
      resumeId: "resume_abc",
      modelName: "deepseek-v4-flash",
      input: {
        b: "second",
        a: "first",
        nested: { z: 1, y: 2 },
      },
    });
    const second = buildAiCacheKey({
      scope: "rich_text:polish",
      userId: "user_123",
      resumeId: "resume_abc",
      modelName: "deepseek-v4-flash",
      input: {
        nested: { y: 2, z: 1 },
        a: "first",
        b: "second",
      },
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^ai_cache:rich_text:polish:[a-f0-9]{24}:[a-f0-9]{24}:[a-f0-9]{32}$/);
    expect(first).not.toContain("user_123");
    expect(first).not.toContain("resume_abc");
  });

  it("uses conservative TTLs per generation scope", () => {
    expect(getAiCacheTtlSeconds("rich_text:polish")).toBe(7 * 24 * 60 * 60);
    expect(getAiCacheTtlSeconds("resume:helper")).toBe(24 * 60 * 60);
    expect(getAiCacheTtlSeconds("agent:chat")).toBe(10 * 60);
  });

  it("serializes cache entries through Redis with expiry", async () => {
    const redis = new FakeAiCacheRedis();
    const store = createRedisAiCacheStore(redis);

    await store.set(
      "ai_cache:rich_text:polish:u:r:i",
      {
        createdAt: "2026-06-09T00:00:00.000Z",
        value: { status: "ok", answer: "cached" },
      },
      600,
    );

    await expect(store.get("ai_cache:rich_text:polish:u:r:i")).resolves.toEqual({
      createdAt: "2026-06-09T00:00:00.000Z",
      value: { status: "ok", answer: "cached" },
    });
    expect(redis.setCalls).toEqual([
      {
        key: "ai_cache:rich_text:polish:u:r:i",
        value: JSON.stringify({
          createdAt: "2026-06-09T00:00:00.000Z",
          value: { status: "ok", answer: "cached" },
        }),
        options: { EX: 600 },
      },
    ]);
  });
});

class FakeAiCacheRedis implements AiCacheRedis {
  readonly setCalls: Array<{
    key: string;
    value: string;
    options: { EX: number };
  }> = [];
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    options: { EX: number },
  ): Promise<"OK" | null> {
    this.setCalls.push({ key, value, options });
    this.values.set(key, value);
    return "OK";
  }
}
