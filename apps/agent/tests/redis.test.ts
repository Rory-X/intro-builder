import { describe, expect, it } from "vitest";

import {
  checkRedisReady,
  createRedisReplayStore,
  type RedisConnection,
} from "../src/redis";

describe("Redis readiness", () => {
  it("connects lazily and reports ready after PONG", async () => {
    const redis = new FakeRedisConnection({ pingResponse: "PONG" });

    await expect(checkRedisReady(redis)).resolves.toEqual({ ok: true });
    expect(redis.connectCalls).toBe(1);
    expect(redis.pingCalls).toBe(1);
  });

  it("does not reconnect when the client is already open", async () => {
    const redis = new FakeRedisConnection({ isOpen: true, pingResponse: "PONG" });

    await expect(checkRedisReady(redis)).resolves.toEqual({ ok: true });
    expect(redis.connectCalls).toBe(0);
    expect(redis.pingCalls).toBe(1);
  });

  it("returns a structured not-ready result when Redis fails", async () => {
    const redis = new FakeRedisConnection({ connectError: new Error("ECONNREFUSED") });

    await expect(checkRedisReady(redis)).resolves.toEqual({
      ok: false,
      message: "Redis unavailable: ECONNREFUSED",
    });
  });

  it("times out hanging Redis connections and disconnects them", async () => {
    const redis = new FakeRedisConnection({ hangOnConnect: true });

    await expect(checkRedisReady(redis, { timeoutMs: 1 })).resolves.toEqual({
      ok: false,
      message: "Redis unavailable: Redis readiness timed out after 1ms",
    });
    expect(redis.disconnectCalls).toBe(1);
  });

  it("connects lazily before reserving replay guard keys", async () => {
    const redis = new FakeRedisConnection({ pingResponse: "PONG" });
    const replayStore = createRedisReplayStore(redis, { timeoutMs: 100 });

    await expect(
      replayStore.set("auth:jti:jti_123", "1", { NX: true, EX: 180 }),
    ).resolves.toBe("OK");

    expect(redis.connectCalls).toBe(1);
    expect(redis.setCalls).toEqual([
      {
        key: "auth:jti:jti_123",
        value: "1",
        options: { NX: true, EX: 180 },
      },
    ]);
  });
});

class FakeRedisConnection implements RedisConnection {
  connectCalls = 0;
  disconnectCalls = 0;
  pingCalls = 0;
  setCalls: Array<{
    key: string;
    value: string;
    options: { NX: true; EX: number };
  }> = [];
  isOpen: boolean;

  constructor(
    private readonly options: {
      isOpen?: boolean;
      pingResponse?: string;
      connectError?: Error;
      hangOnConnect?: boolean;
    },
  ) {
    this.isOpen = options.isOpen ?? false;
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;

    if (this.options.connectError) {
      throw this.options.connectError;
    }

    if (this.options.hangOnConnect) {
      await new Promise(() => {});
    }

    this.isOpen = true;
  }

  async ping(): Promise<string> {
    this.pingCalls += 1;
    return this.options.pingResponse ?? "PONG";
  }

  async incr(): Promise<number> {
    return 1;
  }

  async expire(): Promise<unknown> {
    return "OK";
  }

  async set(
    key: string,
    value: string,
    options: { NX: true; EX: number },
  ): Promise<"OK" | null> {
    this.setCalls.push({ key, value, options });
    return "OK";
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }
}
