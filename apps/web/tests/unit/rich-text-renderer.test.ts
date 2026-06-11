import { describe, expect, it } from "vitest";
import { normalizeRichTextHtml } from "@/components/preview/rich-text-renderer";

describe("normalizeRichTextHtml", () => {
  it("normalizes browser rgb colors to hex for stable hydration", () => {
    expect(
      normalizeRichTextHtml('<span style="color: rgb(0, 0, 0);">文字</span>'),
    ).toBe('<span style="color: #000000;">文字</span>');
  });

  it("keeps inline font sizes relative to resume base size", () => {
    expect(
      normalizeRichTextHtml('<span style="font-size: 14px;">文字</span>'),
    ).toBe('<span style="font-size: 1.08em;">文字</span>');
  });
});
