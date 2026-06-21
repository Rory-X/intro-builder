import { renderToString } from "react-dom/server";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentBubble } from "@/components/agent/agent-bubble";

const originalWindow = globalThis.window;
const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
const originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;

describe("AgentBubble", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    originalWindow.localStorage.clear();
    HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
    HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
    vi.restoreAllMocks();
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

  it("keeps header action buttons clickable instead of starting a window drag", () => {
    const setPointerCapture = vi.fn();
    HTMLElement.prototype.setPointerCapture = setPointerCapture;
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    const onDockToPanel = vi.fn();

    render(
      <AgentBubble title="AI 简历助手" defaultOpen onDockToPanel={onDockToPanel}>
        <div>assistant</div>
      </AgentBubble>,
    );

    const dockButton = screen.getByRole("button", { name: "停靠到左侧编辑区" });
    fireEvent.pointerDown(dockButton, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(dockButton);

    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(onDockToPanel).toHaveBeenCalledTimes(1);
  });

  it("keeps the header minimize button clickable instead of starting a window drag", () => {
    const setPointerCapture = vi.fn();
    HTMLElement.prototype.setPointerCapture = setPointerCapture;
    HTMLElement.prototype.releasePointerCapture = vi.fn();

    render(
      <AgentBubble title="AI 简历助手" defaultOpen>
        <div>assistant</div>
      </AgentBubble>,
    );

    const dialog = screen.getByRole("dialog", { name: "AI 简历助手" });
    const minimizeButton = within(dialog).getByRole("button", {
      name: "收起 AI 简历助手",
    });
    fireEvent.pointerDown(minimizeButton, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(minimizeButton);

    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "AI 简历助手" })).not.toBeInTheDocument();
  });

});
