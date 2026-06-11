import { describe, it, expect } from "vitest";
import { LINE_HEIGHT_PRESETS, PAGE_PADDING_PRESETS } from "@/lib/style-presets";
import { DEFAULT_STYLE_SETTINGS } from "@intro-builder/shared/schemas";

describe("layout presets", () => {
  it("splits line-height and page-padding presets so font size is never overwritten", () => {
    expect(LINE_HEIGHT_PRESETS.compact.value).toBe(1.35);
    expect(LINE_HEIGHT_PRESETS.standard.value).toBe(DEFAULT_STYLE_SETTINGS.lineHeight);
    expect(LINE_HEIGHT_PRESETS.relaxed.value).toBe(1.75);

    expect(PAGE_PADDING_PRESETS.narrow.value).toBe(28);
    expect(PAGE_PADDING_PRESETS.standard.value).toBe(DEFAULT_STYLE_SETTINGS.pagePadding);
    expect(PAGE_PADDING_PRESETS.wide.value).toBe(48);
  });
});
