import { describe, it, expect } from "vitest";
import { DENSITY_PRESETS } from "@/lib/style-presets";
import { DEFAULT_STYLE_SETTINGS } from "@/lib/resume-schema";

describe("density presets", () => {
  it("maps compact/standard/relaxed to concrete styleSettings", () => {
    expect(DENSITY_PRESETS.compact.settings.fontSize).toBe(11);
    expect(DENSITY_PRESETS.compact.settings.lineHeight).toBe(1.35);
    expect(DENSITY_PRESETS.standard.settings).toEqual(DEFAULT_STYLE_SETTINGS);
    expect(DENSITY_PRESETS.relaxed.settings.pagePadding).toBe(48);
  });
});
