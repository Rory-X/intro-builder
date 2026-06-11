import { describe, expect, it } from "vitest";
import { tiptapExtensions } from "@/lib/tiptap-extensions";

describe("tiptapExtensions", () => {
  it("disables StarterKit extensions that are configured separately", () => {
    const starterKit = tiptapExtensions[0] as {
      options: { link?: unknown; underline?: unknown };
    };

    expect(starterKit.options.link).toBe(false);
    expect(starterKit.options.underline).toBe(false);
  });
});
