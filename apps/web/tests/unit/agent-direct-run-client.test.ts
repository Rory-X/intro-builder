import { describe, expect, it, vi } from "vitest";

import { openPanelRunStream } from "@/lib/agent/direct-run-client";

describe("openPanelRunStream", () => {
  it("只请求 Next.js 入口，即使响应里带着旧服务地址也不再跟过去", async () => {
    const bootstrap = Response.json({
      status: "ok",
      streamUrl: "https://api.rory-x.me/intro-builder/agent/v1/agent/chat",
      token: "signed-chat-token",
      tokenExpiresAt: "2026-06-08T08:02:00.000Z",
      request: { resumeId: "resume_abc" },
    });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(bootstrap);

    const response = await openPanelRunStream({
      requestUrl: "/api/agent/direct-runs",
      requestInit: {
        method: "POST",
        body: JSON.stringify({ threadId: "resume_abc" }),
      },
      fetchFn,
      directEnabled: true,
    });

    expect(response).toBe(bootstrap);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/agent/direct-runs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Accept: "text/event-stream" }),
      }),
    );
    const urls = fetchFn.mock.calls.map((call) => String(call[0]));
    expect(urls.join(" ")).not.toContain("api.rory-x.me");
  });

  it("失败响应原样返回，不再发第二次请求", async () => {
    const failed = Response.json({ error: "请先连接模型" }, { status: 400 });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(failed);

    const response = await openPanelRunStream({
      requestUrl: "/api/agent/direct-runs",
      requestInit: {
        method: "POST",
        body: JSON.stringify({ threadId: "resume_abc" }),
      },
      fetchFn,
      directEnabled: true,
    });

    expect(response).toBe(failed);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("测试环境保持调用方给出的地址，避免组件测试被改道", async () => {
    const stream = new Response("data: {}\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(stream);
    const requestInit = {
      method: "POST",
      body: JSON.stringify({ threadId: "resume_abc" }),
    };

    const response = await openPanelRunStream({
      requestUrl: "/api/agent/direct-runs",
      requestInit,
      fetchFn,
      directEnabled: false,
    });

    expect(response).toBe(stream);
    expect(fetchFn).toHaveBeenCalledWith("/api/agent/direct-runs", requestInit);
  });
});
