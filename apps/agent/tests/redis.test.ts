import { describe, expect, it } from "vitest";

import { checkRedisReady, type RedisReadyConnection } from "../src/redis";

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
});

class FakeRedisConnection implements RedisReadyConnection {
  connectCalls = 0;
  disconnectCalls = 0;
  pingCalls = 0;
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

  disconnect(): void {
    this.disconnectCalls += 1;
  }
}
