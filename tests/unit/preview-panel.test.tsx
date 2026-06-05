import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { emptyResumeContent } from "@/lib/resume-schema";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";

vi.mock("@tiptap/html", () => ({
  generateHTML: () => "",
}));

const RESOLVED_TEMPLATE: SerializableResolvedTemplate = {
  source: "unified",
  id: "professional",
  html: '<article><slot data-bind="basics.name"></slot></article>',
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
});
