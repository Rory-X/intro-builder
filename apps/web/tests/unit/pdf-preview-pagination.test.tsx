import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PdfPreview } from "@/components/preview/pdf-preview";
import { emptyResumeContent } from "@/lib/resume-schema";

vi.mock("@/lib/templates/render", () => ({
  ClientTemplateRenderFromSerializable: () => (
    <article>
      <div data-pagination-item>
        <p data-line-fixture>第一行 第二行 第三行 第四行 第五行</p>
      </div>
    </article>
  ),
}));

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 794,
    width: 794,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("PdfPreview pagination", () => {
  let measuredHeight = 0;
  let originalScrollHeight: PropertyDescriptor | undefined;
  let originalGetBoundingClientRect: typeof HTMLElement.prototype.getBoundingClientRect;
  let originalCreateRange: typeof document.createRange;

  function setMeasuredHeight(height: number) {
    measuredHeight = height;
  }

  beforeEach(() => {
    originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    originalCreateRange = document.createRange;

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute("aria-hidden") === "true" ? measuredHeight : 0;
      },
    });

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.hasAttribute("aria-hidden")) {
        return rect(0, 0);
      }

      if (this.hasAttribute("data-pagination-item") || this.hasAttribute("data-line-fixture")) {
        return rect(0, measuredHeight);
      }

      return rect(0, 0);
    };
  });

  afterEach(() => {
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
    }
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    document.createRange = originalCreateRange;
  });

  it("keeps content below one A4 page on a single PDF page", async () => {
    setMeasuredHeight(1100);

    render(
      <PdfPreview
        content={emptyResumeContent()}
        resolved={{
          source: "unified",
          id: "professional",
          templateId: "professional",
          html: "<article></article>",
          css: null,
        }}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector("[data-pdf-ready]")).toHaveAttribute(
        "data-pdf-num-pages",
        "1",
      );
    });
  });

  it("does not create a blank trailing page for tiny overflow", async () => {
    setMeasuredHeight(1150);

    render(
      <PdfPreview
        content={emptyResumeContent()}
        resolved={{
          source: "unified",
          id: "professional",
          templateId: "professional",
          html: "<article></article>",
          css: null,
        }}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector("[data-pdf-ready]")).toHaveAttribute(
        "data-pdf-num-pages",
        "1",
      );
    });
  });

  it("breaks at a previous text line instead of cutting through a line", async () => {
    setMeasuredHeight(1400);
    document.createRange = () => ({
      selectNodeContents: vi.fn(),
      getClientRects: () => [
        rect(0, 180),
        rect(180, 420),
        rect(420, 660),
        rect(660, 900),
        rect(900, 1140),
      ],
      detach: vi.fn(),
    } as unknown as Range);

    render(
      <PdfPreview
        content={emptyResumeContent()}
        resolved={{
          source: "unified",
          id: "professional",
          templateId: "professional",
          html: "<article></article>",
          css: null,
        }}
      />,
    );

    await waitFor(() => {
      const ready = document.querySelector("[data-pdf-ready]");
      expect(ready).toHaveAttribute("data-pdf-num-pages", "2");
      expect(ready).toHaveAttribute("data-pdf-breaks", "[894]");
    });
  });

  it("uses editor-provided page breaks when available", async () => {
    setMeasuredHeight(900);

    render(
      <PdfPreview
        content={emptyResumeContent()}
        resolved={{
          source: "unified",
          id: "professional",
          templateId: "professional",
          html: "<article></article>",
          css: null,
        }}
        initialPagination={{ pageBreaks: [700], totalHeight: 1300 }}
      />,
    );

    await waitFor(() => {
      const ready = document.querySelector("[data-pdf-ready]");
      expect(ready).toHaveAttribute("data-pdf-num-pages", "2");
      expect(ready).toHaveAttribute("data-pdf-breaks", "[700]");
      expect(ready).toHaveAttribute("data-pdf-total-height", "1300");
    });
  });
});
