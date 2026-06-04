import { describe, it, expect } from "vitest";
import {
  DEFAULT_TEMPLATE_ID,
  TEMPLATES,
  resolveTemplateId,
  getTemplateMeta,
} from "@/lib/templates/registry";

describe("template registry", () => {
  it("includes professional as recommended default", () => {
    expect(DEFAULT_TEMPLATE_ID).toBe("professional");
    const pro = TEMPLATES.find((t) => t.id === "professional");
    expect(pro?.isRecommended).toBe(true);
    expect(TEMPLATES.map((t) => t.id)).toEqual(["professional", "classic", "modern"]);
  });

  it("preserves any non-empty id (DB lookup happens later) and falls back for null", () => {
    expect(resolveTemplateId("unknown")).toBe("unknown");
    expect(resolveTemplateId(null)).toBe("professional");
    expect(resolveTemplateId("classic")).toBe("classic");
  });

  it("returns metadata for known templates", () => {
    const meta = getTemplateMeta("modern");
    expect(meta.name).toBe("现代");
    expect(meta.defaultStyleSettings).toBeDefined();
  });
});
