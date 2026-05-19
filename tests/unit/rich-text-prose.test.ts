import { describe, expect, it } from "vitest";
import { RICH_TEXT_EDITOR_PROSE_CLASS, RICH_TEXT_PROSE_CLASS } from "@/lib/rich-text-prose";

describe("rich text prose classes", () => {
  it("uses theme foreground colors in the editor for dark mode readability", () => {
    expect(RICH_TEXT_EDITOR_PROSE_CLASS).toContain("text-foreground");
    expect(RICH_TEXT_EDITOR_PROSE_CLASS).toContain("prose-invert");
    expect(RICH_TEXT_EDITOR_PROSE_CLASS).not.toContain("text-neutral-800");
  });

  it("keeps resume preview prose on neutral text for white paper output", () => {
    expect(RICH_TEXT_PROSE_CLASS).toContain("text-neutral-800");
  });
});
