import { describe, it, expect } from "vitest";
import {
  resolveTemplateId,
  BUILTIN_TEMPLATE_IDS,
  DEFAULT_TEMPLATE_ID,
} from "@/lib/templates/registry";

describe("resolveTemplateId", () => {
  it("returns the id unchanged for any built-in", () => {
    for (const id of BUILTIN_TEMPLATE_IDS) {
      expect(resolveTemplateId(id)).toBe(id);
    }
  });

  it("returns the id unchanged for unknown ids (DB lookup happens later)", () => {
    expect(resolveTemplateId("uploaded-abbey-001")).toBe("uploaded-abbey-001");
    expect(resolveTemplateId("any-string")).toBe("any-string");
  });

  it("falls back to default for null/undefined/empty", () => {
    expect(resolveTemplateId(null)).toBe(DEFAULT_TEMPLATE_ID);
    expect(resolveTemplateId(undefined)).toBe(DEFAULT_TEMPLATE_ID);
    expect(resolveTemplateId("")).toBe(DEFAULT_TEMPLATE_ID);
  });
});
