import { describe, expect, it } from "vitest";
import {
  interpolateSettings,
  findOptimalSettings,
  A4_HEIGHT_PX,
} from "@/lib/smart-layout";
import type { StyleSettings } from "@/lib/resume-schema";

describe("interpolateSettings", () => {
  const current: StyleSettings = {
    fontFamily: "sans",
    fontSize: 14,
    lineHeight: 1.6,
    pagePadding: 40,
  };

  it("returns current settings when scale=1", () => {
    const result = interpolateSettings(current, 1);
    expect(result.fontFamily).toBe("sans");
    expect(result.fontSize).toBe(14);
    expect(result.lineHeight).toBe(1.6);
    expect(result.pagePadding).toBe(40);
  });

  it("returns min settings when scale=0", () => {
    const result = interpolateSettings(current, 0);
    expect(result.fontFamily).toBe("sans");
    expect(result.fontSize).toBe(10);
    expect(result.lineHeight).toBe(1.2);
    expect(result.pagePadding).toBe(20);
  });

  it("returns midpoint settings when scale=0.5", () => {
    const result = interpolateSettings(current, 0.5);
    expect(result.fontFamily).toBe("sans");
    // fontSize: 10 + (14-10)*0.5 = 12
    expect(result.fontSize).toBe(12);
    // lineHeight: 1.2 + (1.6-1.2)*0.5 = 1.4
    expect(result.lineHeight).toBe(1.4);
    // pagePadding: 20 + (40-20)*0.5 = 30
    expect(result.pagePadding).toBe(30);
  });

  it("preserves fontFamily regardless of scale", () => {
    const serif: StyleSettings = { ...current, fontFamily: "serif" };
    expect(interpolateSettings(serif, 0).fontFamily).toBe("serif");
    expect(interpolateSettings(serif, 0.5).fontFamily).toBe("serif");
    expect(interpolateSettings(serif, 1).fontFamily).toBe("serif");
  });

  it("keeps fontSize within bounds [10, 16]", () => {
    const maxFont: StyleSettings = { ...current, fontSize: 16 };
    for (let s = 0; s <= 1; s += 0.1) {
      const result = interpolateSettings(maxFont, s);
      expect(result.fontSize).toBeGreaterThanOrEqual(10);
      expect(result.fontSize).toBeLessThanOrEqual(16);
    }
  });
});

describe("findOptimalSettings", () => {
  const current: StyleSettings = {
    fontFamily: "sans",
    fontSize: 14,
    lineHeight: 1.6,
    pagePadding: 40,
  };

  it("returns 'already-fits' when content fits at current settings", async () => {
    const measure = async () => A4_HEIGHT_PX - 100; // well under limit
    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("already-fits");
  });

  it("returns 'already-fits' when content exactly equals A4 height", async () => {
    const measure = async () => A4_HEIGHT_PX; // exactly at limit
    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("already-fits");
  });

  it("returns 'cannot-fit' with most compact settings when even min settings overflow", async () => {
    const measure = async () => A4_HEIGHT_PX + 200; // always too tall
    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("cannot-fit");
    // Should still return the most compact settings
    if (result.status === "cannot-fit") {
      expect(result.settings.fontSize).toBe(10);
      expect(result.settings.lineHeight).toBe(1.2);
      expect(result.settings.pagePadding).toBe(20);
    }
  });

  it("returns 'optimized' with reduced settings for a typical case", async () => {
    // Simulate: content height decreases linearly as settings shrink
    // At scale=1 (current): 1300px (overflows)
    // At scale=0 (min): 900px (fits)
    // Crossover at scale ~0.56 (1300 - 400*scale = 1123 → scale ≈ 0.44 above)
    const measure = async (settings: StyleSettings) => {
      // Simple linear model based on fontSize
      // fontSize ranges from 10 (scale=0) to 14 (scale=1)
      const ratio = (settings.fontSize - 10) / (14 - 10); // 0..1
      return 900 + ratio * 400; // 900..1300
    };

    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("optimized");

    if (result.status === "optimized") {
      // The optimized settings should produce content <= A4_HEIGHT_PX
      const h = await measure(result.settings);
      expect(h).toBeLessThanOrEqual(A4_HEIGHT_PX);

      // Settings should be reduced from current
      expect(result.settings.fontSize).toBeLessThan(current.fontSize);
      expect(result.settings.lineHeight).toBeLessThan(current.lineHeight);
      expect(result.settings.pagePadding).toBeLessThan(current.pagePadding);

      // But still above minimums (since we have room)
      expect(result.settings.fontSize).toBeGreaterThan(10);
      expect(result.settings.lineHeight).toBeGreaterThan(1.2);
      expect(result.settings.pagePadding).toBeGreaterThan(20);
    }
  });

  it("binary search converges close to optimal", async () => {
    // Precise model: fits exactly at scale=0.7
    // height = 1123 when scale=0.7, height > 1123 when scale > 0.7
    const measure = async (settings: StyleSettings) => {
      const scale = (settings.fontSize - 10) / (14 - 10);
      // At scale=0.7: height = 1123 (exactly fits)
      // Linear: height = 800 + scale * (1123 - 800) / 0.7
      return 800 + scale * (323 / 0.7);
    };

    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("optimized");

    if (result.status === "optimized") {
      // After 8 iterations, precision is 1/256 ≈ 0.004
      // The found scale should be close to 0.7
      const foundScale = (result.settings.fontSize - 10) / (14 - 10);
      expect(foundScale).toBeCloseTo(0.7, 1); // within 0.05
    }
  });
});
