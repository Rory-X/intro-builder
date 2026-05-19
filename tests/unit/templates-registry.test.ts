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

  it("resolves unknown template ids to professional", () => {
    expect(resolveTemplateId("unknown")).toBe("professional");
    expect(resolveTemplateId(null)).toBe("professional");
    expect(resolveTemplateId("classic")).toBe("classic");
  });

  it("returns metadata with layout component", () => {
    const meta = getTemplateMeta("modern");
    expect(meta.name).toBe("现代");
    expect(meta.Layout).toBeDefined();
  });
});
