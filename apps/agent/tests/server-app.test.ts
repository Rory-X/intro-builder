import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { createAgentApp } from "../src/server/app.js";

const config = loadConfig({ AGENT_SERVICE_NAME: "intro-agent", AGENT_VERSION: "1.2.3" });

describe("createAgentApp", () => {
  it("GET /health returns ok with service metadata and a request id header", async () => {
    const app = createAgentApp({ config, uptimeSeconds: () => 42 });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", service: "intro-agent", version: "1.2.3", uptimeSeconds: 42 });
  });

  it("GET /ready returns ready when redis is reachable", async () => {
    const app = createAgentApp({ config, redisReady: async () => ({ ok: true }) });
    const res = await app.request("/ready");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ready", dependencies: { redis: "ready" } });
  });

  it("GET /ready returns 503 when redis is unavailable", async () => {
    const app = createAgentApp({
      config,
      redisReady: async () => ({ ok: false, message: "redis down" }),
    });
    const res = await app.request("/ready");
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: "dependency_unavailable", dependency: "redis" });
  });

  it("GET /v1/session without a bearer token returns 401", async () => {
    const app = createAgentApp({ config });
    const res = await app.request("/v1/session");
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: "unauthorized" });
    expect(body.requestId).toBeTruthy();
  });

  it("returns 404 not_found for unknown routes", async () => {
    const app = createAgentApp({ config });
    const res = await app.request("/missing");
    expect(res.status).toBe(404);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("not_found");
  });

  it("echoes an incoming x-request-id", async () => {
    const app = createAgentApp({ config });
    const res = await app.request("/health", { headers: { "x-request-id": "req_fixed" } });
    expect(res.headers.get("x-request-id")).toBe("req_fixed");
  });

  it("POST /v1/rich-text/polish without a bearer token returns 401", async () => {
    const app = createAgentApp({ config });
    const res = await app.request("/v1/rich-text/polish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeId: "r1" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("unauthorized");
  });

  it("POST /v1/resume/helpers/:id without a bearer token returns 401", async () => {
    const app = createAgentApp({ config });
    const res = await app.request("/v1/resume/helpers/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeId: "r1" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("unauthorized");
  });
});
