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
    sectionGap: 16,
    itemGap: 12,
  };

  it("returns current settings when scale=1", () => {
    const result = interpolateSettings(current, 1);
    expect(result.fontFamily).toBe("sans");
    expect(result.fontSize).toBe(14);
    expect(result.lineHeight).toBe(1.6);
    expect(result.pagePadding).toBe(40);
    expect(result.sectionGap).toBe(16);
    expect(result.itemGap).toBe(12);
  });

  it("returns min settings (8 / 1.05 / 8 / 4 / 2) when scale=0", () => {
    const result = interpolateSettings(current, 0);
    expect(result.fontFamily).toBe("sans");
    expect(result.fontSize).toBe(8);
    expect(result.lineHeight).toBe(1.05);
    expect(result.pagePadding).toBe(8);
    expect(result.sectionGap).toBe(4);
    expect(result.itemGap).toBe(2);
  });

  it("returns midpoint settings when scale=0.5", () => {
    const result = interpolateSettings(current, 0.5);
    expect(result.fontFamily).toBe("sans");
    // fontSize: 8 + (14-8)*0.5 = 11
    expect(result.fontSize).toBe(11);
    // lineHeight: 1.05 + (1.6-1.05)*0.5 = 1.325 → rounded to 1.33 (2 decimals)
    expect(result.lineHeight).toBe(1.33);
    // pagePadding: 8 + (40-8)*0.5 = 24
    expect(result.pagePadding).toBe(24);
    // sectionGap: 4 + (16-4)*0.5 = 10
    expect(result.sectionGap).toBe(10);
    // itemGap: 2 + (12-2)*0.5 = 7
    expect(result.itemGap).toBe(7);
  });

  it("preserves fontFamily regardless of scale", () => {
    const serif: StyleSettings = { ...current, fontFamily: "serif" };
    expect(interpolateSettings(serif, 0).fontFamily).toBe("serif");
    expect(interpolateSettings(serif, 0.5).fontFamily).toBe("serif");
    expect(interpolateSettings(serif, 1).fontFamily).toBe("serif");
  });

  it("keeps fontSize within bounds [8, 16]", () => {
    const maxFont: StyleSettings = { ...current, fontSize: 16 };
    for (let s = 0; s <= 1; s += 0.1) {
      const result = interpolateSettings(maxFont, s);
      expect(result.fontSize).toBeGreaterThanOrEqual(8);
      expect(result.fontSize).toBeLessThanOrEqual(16);
    }
  });

  it("keeps sectionGap and itemGap within new bounds", () => {
    for (let s = 0; s <= 1; s += 0.1) {
      const result = interpolateSettings(current, s);
      expect(result.sectionGap).toBeGreaterThanOrEqual(4);
      expect(result.sectionGap).toBeLessThanOrEqual(16);
      expect(result.itemGap).toBeGreaterThanOrEqual(2);
      expect(result.itemGap).toBeLessThanOrEqual(12);
    }
  });
});

describe("findOptimalSettings", () => {
  const current: StyleSettings = {
    fontFamily: "sans",
    fontSize: 14,
    lineHeight: 1.6,
    pagePadding: 40,
    sectionGap: 16,
    itemGap: 12,
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
    // Should still return the most compact settings (5-dim MIN)
    if (result.status === "cannot-fit") {
      expect(result.settings.fontSize).toBe(8);
      expect(result.settings.lineHeight).toBe(1.05);
      expect(result.settings.pagePadding).toBe(8);
      expect(result.settings.sectionGap).toBe(4);
      expect(result.settings.itemGap).toBe(2);
    }
  });

  it("returns 'optimized' with reduced settings for a typical case", async () => {
    // Simulate: content height decreases linearly as settings shrink
    // At scale=1 (current): 1300px (overflows)
    // At scale=0 (min): 900px (fits)
    const measure = async (settings: StyleSettings) => {
      const ratio = (settings.fontSize - 8) / (14 - 8); // 0..1
      return 900 + ratio * 400; // 900..1300
    };

    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("optimized");

    if (result.status === "optimized") {
      const h = await measure(result.settings);
      expect(h).toBeLessThanOrEqual(A4_HEIGHT_PX);

      // Settings should be reduced from current
      expect(result.settings.fontSize).toBeLessThan(current.fontSize);
      expect(result.settings.lineHeight).toBeLessThan(current.lineHeight);
      expect(result.settings.pagePadding).toBeLessThan(current.pagePadding);
      expect(result.settings.sectionGap).toBeLessThan(current.sectionGap);
      expect(result.settings.itemGap).toBeLessThan(current.itemGap);

      // But still above new minimums
      expect(result.settings.fontSize).toBeGreaterThan(8);
      expect(result.settings.lineHeight).toBeGreaterThan(1.05);
      expect(result.settings.pagePadding).toBeGreaterThan(8);
      expect(result.settings.sectionGap).toBeGreaterThan(4);
      expect(result.settings.itemGap).toBeGreaterThan(2);
    }
  });

  it("binary search converges close to optimal", async () => {
    // Precise model: fits exactly at scale=0.7
    const measure = async (settings: StyleSettings) => {
      const scale = (settings.fontSize - 8) / (14 - 8);
      return 800 + scale * (323 / 0.7);
    };

    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("optimized");

    if (result.status === "optimized") {
      // After 8 iterations, precision is 1/256 ≈ 0.004
      const foundScale = (result.settings.fontSize - 8) / (14 - 8);
      expect(foundScale).toBeCloseTo(0.7, 1); // within 0.05
    }
  });
});
