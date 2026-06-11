import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatSaveError } from "@/lib/format-save-error";

describe("formatSaveError", () => {
  it("formats zod issues with field path", () => {
    const err = z.object({ basics: z.object({ email: z.string().email() }) }).safeParse({
      basics: { email: "not-an-email" },
    });
    if (err.success) throw new Error("expected failure");
    expect(formatSaveError(err.error)).toContain("basics.email");
  });

  it("formats server invalid messages", () => {
    expect(formatSaveError(new Error("invalid: basics.website"))).toContain("basics.website");
  });
});
