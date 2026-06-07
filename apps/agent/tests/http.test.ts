import { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createAgentServer } from "../src/http";

type TestAgentServer = Server & {
  url: (path: string) => string;
};

const servers: TestAgentServer[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server: TestAgentServer) =>
        new Promise<void>((resolve, reject) => {
          server.close((error?: Error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    ),
  );
});

describe("agent HTTP service", () => {
  it("returns service metadata from /health", async () => {
    const server = await listenOnRandomPort();
    const response = await fetch(server.url("/health"), {
      headers: { "x-request-id": "req-client-health" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBe("req-client-health");
    expect(body).toMatchObject({
      status: "ok",
      service: "intro-agent-test",
      version: "test-version",
      uptimeSeconds: 42,
    });
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns readiness metadata from /ready", async () => {
    const server = await listenOnRandomPort();
    const response = await fetch(server.url("/ready"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      service: "intro-agent-test",
      version: "test-version",
      dependencies: {
        redis: "ready",
      },
    });
  });

  it("returns dependency_unavailable when Redis readiness fails", async () => {
    const server = await listenOnRandomPort({
      redisReady: async () => ({
        ok: false,
        message: "Redis ping failed",
      }),
    });
    const response = await fetch(server.url("/ready"), {
      headers: { "x-request-id": "req-client-ready" },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("req-client-ready");
    await expect(response.json()).resolves.toEqual({
      error: "dependency_unavailable",
      message: "Redis ping failed",
      requestId: "req-client-ready",
      dependency: "redis",
    });
  });

  it("returns JSON 404 responses for unknown paths", async () => {
    const server = await listenOnRandomPort();
    const response = await fetch(server.url("/missing"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "not_found",
      message: "Route not found",
      requestId: "req_test_1",
    });
  });

  it("returns JSON 405 responses for unsupported health methods", async () => {
    const server = await listenOnRandomPort();
    const response = await fetch(server.url("/health"), { method: "POST" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "Method not allowed",
      requestId: "req_test_1",
    });
  });
});

async function listenOnRandomPort(
  options: {
    redisReady?: () => Promise<{ ok: true } | { ok: false; message: string }>;
  } = {},
): Promise<TestAgentServer> {
  const server = createAgentServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      serviceName: "intro-agent-test",
      version: "test-version",
      nodeEnv: "test",
      shutdownTimeoutMs: 100,
      redisUrl: "redis://127.0.0.1:6379",
      redisConnectTimeoutMs: 100,
      rateLimitWindowSeconds: 60,
      rateLimitMaxRequests: 30,
    },
    now: () => new Date("2026-06-05T00:00:00.000Z"),
    uptimeSeconds: () => 42,
    redisReady: options.redisReady ?? (async () => ({ ok: true })),
    createRequestId: () => "req_test_1",
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address() as AddressInfo;
  const testServer = Object.assign(server, {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
  });

  servers.push(testServer);

  return testServer;
}
