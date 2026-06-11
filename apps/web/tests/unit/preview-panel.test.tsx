import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { emptyResumeContent } from "@intro-builder/shared/schemas";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";

vi.mock("@tiptap/html", () => ({
  generateHTML: () => "",
}));

const RESOLVED_TEMPLATE: SerializableResolvedTemplate = {
  source: "unified",
  id: "professional",
  html: '<article><slot data-bind="basic.name"></slot></article>',
  css: null,
  templateId: "professional",
  sectionIcons: {},
};

function renderPreview() {
  const content = emptyResumeContent();
  content.basics.name = "钱嘉豪";

  render(
    <div data-preview-scroll-pane="">
      <PreviewPanel
        content={content}
        resolvedTemplate={RESOLVED_TEMPLATE}
      />
    </div>,
  );

  return {
    exportRoot: screen.getByTestId("resume-export-preview"),
    scrollPane: document.querySelector("[data-preview-scroll-pane]") as HTMLDivElement,
  };
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

describe("PreviewPanel", () => {
  it("exposes an export root containing the resume article", () => {
    const { exportRoot } = renderPreview();

    expect(exportRoot).toBeInTheDocument();
    expect(exportRoot).toHaveTextContent("钱嘉豪");
  });

  it("uses preview zoom for ctrl/meta wheel instead of browser zoom", async () => {
    const { exportRoot } = renderPreview();
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    });

    act(() => {
      exportRoot.dispatchEvent(event);
    });

    await act(async () => {
      await nextFrame();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByTitle("双击重置")).toHaveTextContent("180%");
    expect(screen.getByTitle("双击重置")).not.toHaveAttribute("hidden");
  });

  it("turns dominant horizontal wheel movement into preview pane scrolling", () => {
    const { exportRoot, scrollPane } = renderPreview();
    Object.defineProperty(scrollPane, "clientWidth", { configurable: true, value: 500 });
    Object.defineProperty(scrollPane, "scrollWidth", { configurable: true, value: 1000 });
    scrollPane.scrollLeft = 0;
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaX: 120,
      deltaY: 5,
    });

    act(() => {
      exportRoot.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(scrollPane.scrollLeft).toBe(120);
  });

  it("anchors ctrl/meta wheel zoom to the cursor by adjusting scroll", async () => {
    const { exportRoot, scrollPane } = renderPreview();

    // Mock the zoomed element's geometry to scale with its inline `zoom` (jsdom
    // doesn't apply CSS zoom to layout). Origin at (0,0), base 794×1000 px → the
    // rect grows exactly with the zoom factor, mirroring real browser behavior.
    Object.defineProperty(exportRoot, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const zoom = parseFloat(exportRoot.style.getPropertyValue("zoom") || "1");
        return {
          left: 0, top: 0,
          width: 794 * zoom, height: 1000 * zoom,
          right: 794 * zoom, bottom: 1000 * zoom,
          x: 0, y: 0, toJSON: () => {},
        } as DOMRect;
      },
    });
    // Generous scroll range so the computed delta isn't clamped away.
    Object.defineProperty(scrollPane, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(scrollPane, "scrollWidth", { configurable: true, value: 4000 });
    Object.defineProperty(scrollPane, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scrollPane, "scrollHeight", { configurable: true, value: 4000 });
    scrollPane.scrollLeft = 0;
    scrollPane.scrollTop = 0;

    // Cursor at (100,100); deltaY=-100 → zoom ×1.8. The content point under the
    // cursor must stay under it: targetPos = cursor × (newZoom/oldZoom) = 180,
    // so scroll shifts by 180−100 = 80 on both axes (origin-anchored mock).
    const event = new WheelEvent("wheel", {
      bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100,
      clientX: 100, clientY: 100,
    });

    act(() => {
      exportRoot.dispatchEvent(event);
    });
    await act(async () => {
      await nextFrame();
    });

    expect(scrollPane.scrollLeft).toBe(80);
    expect(scrollPane.scrollTop).toBe(80);
  });
});
