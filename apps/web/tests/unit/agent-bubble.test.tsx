import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { AgentBubble } from "@/components/agent/agent-bubble";

const originalWindow = globalThis.window;

describe("AgentBubble", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    originalWindow.localStorage.clear();
  });

  it("keeps the first client render stable with the server HTML", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });
    const serverHtml = renderToString(
      <AgentBubble title="AI 简历助手">
        <div>assistant</div>
      </AgentBubble>,
    );

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    originalWindow.localStorage.setItem(
      "intro-builder.agent.floating-bubble-position.v1",
      JSON.stringify({ right: 260, bottom: 180 }),
    );

    const clientFirstHtml = renderToString(
      <AgentBubble title="AI 简历助手">
        <div>assistant</div>
      </AgentBubble>,
    );

    expect(clientFirstHtml).toBe(serverHtml);
  });

});
