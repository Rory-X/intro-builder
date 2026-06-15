import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { buildChatSystemPrompt, streamAgentChat } from "../src/agent/chat-runtime.js";
import { createPreview } from "../src/agent/preview.js";

describe("chat runtime", () => {
  it("builds a mode-specific system prompt", () => {
    expect(buildChatSystemPrompt({ mode: "create_from_zero" })).toContain("从零创建");
    expect(buildChatSystemPrompt({ mode: "optimize_existing" })).toContain("优化已有");
    expect(buildChatSystemPrompt({ mode: "create_from_zero", targetRole: "后端工程师" })).toContain("后端工程师");
  });

  it("passes the tool set + converted messages to streamText and returns its UI message stream response", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fakeResult = { toUIMessageStreamResponse: () => new Response("stream-ok") };
    const streamTextImpl = ((opts: Record<string, unknown>) => {
      calls.push(opts);
      return fakeResult;
    }) as never;

    const messages: UIMessage[] = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "帮我写简历" }] },
    ];

    const res = await streamAgentChat({
      model: {} as never,
      mode: "create_from_zero",
      messages,
      preview: createPreview(),
      readResume: async () => null,
      streamTextImpl,
    });

    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].tools as object)).toEqual(
      expect.arrayContaining(["read_resume", "set_goal", "upsert_section", "ask_user"]),
    );
    expect(Array.isArray(calls[0].messages)).toBe(true);
    expect(res).toBeInstanceOf(Response);
  });
});
