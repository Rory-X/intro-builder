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
    headingGap: 8,
    bodyLineHeight: 1.6,
    pagePadding: 40,
    sectionGap: 16,
    itemGap: 12, photoScale: 1,
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

  it("returns min settings when scale=0 (fontSize and pagePadding stay at current — algorithm doesn't compress them)", () => {
    const result = interpolateSettings(current, 0);
    expect(result.fontFamily).toBe("sans");
    expect(result.fontSize).toBe(14);
    expect(result.lineHeight).toBe(1.05);
    expect(result.pagePadding).toBe(40);
    expect(result.sectionGap).toBe(4);
    expect(result.itemGap).toBe(2);
  });

  it("returns midpoint settings when scale=0.5", () => {
    const result = interpolateSettings(current, 0.5);
    expect(result.fontFamily).toBe("sans");
    // fontSize: 固定不变
    expect(result.fontSize).toBe(14);
    // lineHeight: 1.05 + (1.6-1.05)*0.5 = 1.325 → rounded to 1.33 (2 decimals)
    expect(result.lineHeight).toBe(1.33);
    // pagePadding: 不变，仍是 current.pagePadding
    expect(result.pagePadding).toBe(40);
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

  it("keeps fontSize fixed regardless of scale", () => {
    const maxFont: StyleSettings = { ...current, fontSize: 16 };
    for (let s = 0; s <= 1; s += 0.1) {
      const result = interpolateSettings(maxFont, s);
      expect(result.fontSize).toBe(16);
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
    headingGap: 8,
    bodyLineHeight: 1.6,
    pagePadding: 40,
    sectionGap: 16,
    itemGap: 12, photoScale: 1,
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
    if (result.status === "cannot-fit") {
      expect(result.settings.fontSize).toBe(14); // fontSize 不被压缩
      expect(result.settings.lineHeight).toBe(1.05);
      expect(result.settings.pagePadding).toBe(40);
      expect(result.settings.sectionGap).toBe(4);
      expect(result.settings.itemGap).toBe(2);
    }
  });

  it("returns 'optimized' with reduced settings for a typical case", async () => {
    // Simulate: content height decreases linearly as sectionGap shrinks
    // At scale=1 (current sectionGap=16): 1300px (overflows)
    // At scale=0 (min sectionGap=4): 900px (fits)
    const measure = async (settings: StyleSettings) => {
      const ratio = (settings.sectionGap - 4) / (16 - 4); // 0..1
      return 900 + ratio * 400; // 900..1300
    };

    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("optimized");

    if (result.status === "optimized") {
      const h = await measure(result.settings);
      expect(h).toBeLessThanOrEqual(A4_HEIGHT_PX);

      // fontSize 不被压缩，其他间距被压缩
      expect(result.settings.fontSize).toBe(current.fontSize);
      expect(result.settings.lineHeight).toBeLessThan(current.lineHeight);
      expect(result.settings.pagePadding).toBe(current.pagePadding);
      expect(result.settings.sectionGap).toBeLessThan(current.sectionGap);
      expect(result.settings.itemGap).toBeLessThan(current.itemGap);

      // But still above new minimums
      expect(result.settings.lineHeight).toBeGreaterThan(1.05);
      expect(result.settings.sectionGap).toBeGreaterThan(4);
      expect(result.settings.itemGap).toBeGreaterThan(2);
    }
  });

  it("binary search converges close to optimal", async () => {
    // Precise model: fits exactly at scale=0.7 (using sectionGap as proxy)
    const measure = async (settings: StyleSettings) => {
      const scale = (settings.sectionGap - 4) / (16 - 4);
      return 800 + scale * (323 / 0.7);
    };

    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("optimized");

    if (result.status === "optimized") {
      // After 8 iterations, precision is 1/256 ≈ 0.004
      const foundScale = (result.settings.sectionGap - 4) / (16 - 4);
      expect(foundScale).toBeCloseTo(0.7, 1); // within 0.05
    }
  });
});
