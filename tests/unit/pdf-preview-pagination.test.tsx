import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PdfPreview } from "@/components/preview/pdf-preview";
import { emptyResumeContent } from "@/lib/resume-schema";

vi.mock("@/lib/templates/render", () => ({
  ClientTemplateRenderFromSerializable: () => (
    <article>
      <div data-pagination-header>单页简历内容</div>
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

  function setMeasuredHeight(height: number) {
    measuredHeight = height;
  }

  beforeEach(() => {
    originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute("aria-hidden") === "true" ? measuredHeight : 0;
      },
    });

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.hasAttribute("data-pagination-header")) {
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
  });

  it("keeps content below one A4 page on a single PDF page", async () => {
    setMeasuredHeight(1100);

    render(
      <PdfPreview
        content={emptyResumeContent()}
        resolved={{ source: "builtin", id: "professional" }}
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
        resolved={{ source: "builtin", id: "professional" }}
      />,
    );

    await waitFor(() => {
      expect(document.querySelector("[data-pdf-ready]")).toHaveAttribute(
        "data-pdf-num-pages",
        "1",
      );
    });
  });
});
