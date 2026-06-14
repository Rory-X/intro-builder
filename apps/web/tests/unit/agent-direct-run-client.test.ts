import { describe, expect, it, vi } from "vitest";

import { fetchDirectAgentRunStream } from "@/lib/agent/direct-run-client";

describe("fetchDirectAgentRunStream", () => {
  it("bootstraps through the BFF then opens the direct Agent stream", async () => {
    const directStream = new Response("data: {}\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          status: "ok",
          streamUrl: "https://api.rory-x.me/intro-builder/agent/v1/agent/messages",
          token: "signed-chat-token",
          tokenExpiresAt: "2026-06-08T08:02:00.000Z",
          request: {
            resumeId: "resume_abc",
            locale: "zh-CN",
            workflowId: "resume-diagnose",
            messages: [{ id: "msg_user_1", role: "user", content: "诊断" }],
            context: {
              resumeTitle: "前端工程师",
              templateId: "professional",
              activeSection: null,
              completeness: { overall: 80, sections: [] },
              sections: [],
            },
          },
        }),
      )
      .mockResolvedValueOnce(directStream);

    const response = await fetchDirectAgentRunStream({
      requestUrl: "/api/agent/runs",
      requestInit: {
        method: "POST",
        body: JSON.stringify({ threadId: "resume_abc" }),
        headers: { "content-type": "application/json" },
      },
      fetchFn,
      directEnabled: true,
    });

    expect(response).toBe(directStream);
    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      "/api/agent/direct-runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ threadId: "resume_abc" }),
      }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      "https://api.rory-x.me/intro-builder/agent/v1/agent/messages",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"resumeId":"resume_abc"'),
        headers: expect.objectContaining({
          Authorization: "Bearer signed-chat-token",
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("falls back to the BFF stream when direct bootstrap fails before streaming", async () => {
    const fallbackStream = new Response("data: {}\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: "disabled" }, { status: 503 }))
      .mockResolvedValueOnce(fallbackStream);

    const requestInit = {
      method: "POST",
      body: JSON.stringify({ threadId: "resume_abc" }),
      headers: { "content-type": "application/json" },
    };

    const response = await fetchDirectAgentRunStream({
      requestUrl: "/api/agent/runs",
      requestInit,
      fetchFn,
      directEnabled: true,
    });

    expect(response).toBe(fallbackStream);
    expect(fetchFn).toHaveBeenNthCalledWith(2, "/api/agent/runs", requestInit);
  });
});
