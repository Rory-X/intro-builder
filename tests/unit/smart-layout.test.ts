import { describe, expect, it } from "vitest";
import {
  interpolateSettings,
  findOptimalSettings,
  A4_HEIGHT_PX,
} from "@/lib/smart-layout";
import type { StyleSettings } from "@/lib/resume-schema";

// 新行为（zoo 确认）：
// - 美观 floor：font 11 / lineHeight 1.25 / sectionGap 8 / itemGap 4 / headingGap 4。
// - 分两段（FONT_KNEE=0.5）：scale ∈ [0.5,1] 只压间距/行距、字号保持 current；
//   scale ∈ [0,0.5] 间距已触底、改为分级压字号到 floor。
const current: StyleSettings = {
  fontFamily: "sans",
  fontSize: 14,
  lineHeight: 1.6,
  headingGap: 8,
  bodyLineHeight: 1.6,
  pagePadding: 40,
  sectionGap: 16,
  itemGap: 12,
  photoScale: 1,
};

describe("interpolateSettings", () => {
  it("returns current settings when scale=1", () => {
    const result = interpolateSettings(current, 1);
    expect(result.fontFamily).toBe("sans");
    expect(result.fontSize).toBe(14);
    expect(result.bodyLineHeight).toBe(1.6);
    expect(result.lineHeight).toBe(1.6); // 镜像 bodyLineHeight
    expect(result.pagePadding).toBe(40);
    expect(result.sectionGap).toBe(16);
    expect(result.itemGap).toBe(12);
    expect(result.headingGap).toBe(8);
  });

  it("returns aesthetic floor (incl. font floor) when scale=0", () => {
    const result = interpolateSettings(current, 0);
    expect(result.fontFamily).toBe("sans");
    expect(result.fontSize).toBe(11); // 正文字号压到 floor
    expect(result.bodyLineHeight).toBe(1.25);
    expect(result.lineHeight).toBe(1.25);
    expect(result.pagePadding).toBe(40); // 页边距不压
    expect(result.sectionGap).toBe(8);
    expect(result.itemGap).toBe(4);
    expect(result.headingGap).toBe(4);
  });

  it("at the knee (scale=0.5): gaps bottomed out, font still at current", () => {
    const result = interpolateSettings(current, 0.5);
    expect(result.bodyLineHeight).toBe(1.25);
    expect(result.sectionGap).toBe(8);
    expect(result.itemGap).toBe(4);
    expect(result.headingGap).toBe(4);
    expect(result.fontSize).toBe(14);
  });

  it("compresses only gaps (not font) in the upper band [knee, 1]", () => {
    const result = interpolateSettings(current, 0.75);
    expect(result.fontSize).toBe(14); // 字号不动
    // gapScale = (0.75-0.5)/0.5 = 0.5
    expect(result.sectionGap).toBe(12); // 8 + (16-8)*0.5
    expect(result.itemGap).toBe(8); // 4 + (12-4)*0.5
    expect(result.bodyLineHeight).toBe(1.43); // 1.25 + (1.6-1.25)*0.5 → 1.425→1.43
  });

  it("compresses font (gaps already at floor) in the lower band [0, knee]", () => {
    const result = interpolateSettings(current, 0.25);
    // fontScale = 0.25/0.5 = 0.5 → 11 + (14-11)*0.5 = 12.5
    expect(result.fontSize).toBe(12.5);
    expect(result.sectionGap).toBe(8);
    expect(result.itemGap).toBe(4);
    expect(result.bodyLineHeight).toBe(1.25);
  });

  it("keeps fontSize at current for every scale >= knee, and never below floor", () => {
    for (let s = 0; s <= 1.0001; s += 0.1) {
      const r = interpolateSettings(current, s);
      expect(r.fontSize).toBeGreaterThanOrEqual(11);
      expect(r.fontSize).toBeLessThanOrEqual(14);
      if (s >= 0.5) expect(r.fontSize).toBe(14);
    }
  });

  it("preserves fontFamily regardless of scale", () => {
    const serif: StyleSettings = { ...current, fontFamily: "serif" };
    expect(interpolateSettings(serif, 0).fontFamily).toBe("serif");
    expect(interpolateSettings(serif, 0.5).fontFamily).toBe("serif");
    expect(interpolateSettings(serif, 1).fontFamily).toBe("serif");
  });

  it("never expands a setting above current when its value is below the floor", () => {
    // 用户已经把字号/间距设得比 floor 还低 —— 压缩绝不能反向放大。
    const tiny: StyleSettings = {
      ...current,
      fontSize: 10, // < MIN_FONT 11
      sectionGap: 4, // < MIN_SECTION_GAP 8
      itemGap: 2, // < MIN_ITEM_GAP 4
      bodyLineHeight: 1.1, // < MIN_LINE_HEIGHT 1.25
    };
    for (let s = 0; s <= 1.0001; s += 0.25) {
      const r = interpolateSettings(tiny, s);
      expect(r.fontSize).toBe(10); // floor=min(11,10)=10 → 恒定，不被放大
      expect(r.sectionGap).toBeLessThanOrEqual(4);
      expect(r.itemGap).toBeLessThanOrEqual(2);
      expect(r.bodyLineHeight).toBeLessThanOrEqual(1.1);
    }
  });

  it("keeps sectionGap and itemGap within the new bounds", () => {
    for (let s = 0; s <= 1.0001; s += 0.1) {
      const result = interpolateSettings(current, s);
      expect(result.sectionGap).toBeGreaterThanOrEqual(8);
      expect(result.sectionGap).toBeLessThanOrEqual(16);
      expect(result.itemGap).toBeGreaterThanOrEqual(4);
      expect(result.itemGap).toBeLessThanOrEqual(12);
    }
  });
});

describe("findOptimalSettings", () => {
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

  it("returns 'cannot-fit' with most compact (floor) settings when even min overflows", async () => {
    const measure = async () => A4_HEIGHT_PX + 200; // always too tall
    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("cannot-fit");
    if (result.status === "cannot-fit") {
      expect(result.settings.fontSize).toBe(11); // 正文字号压到 floor
      expect(result.settings.bodyLineHeight).toBe(1.25);
      expect(result.settings.pagePadding).toBe(40);
      expect(result.settings.sectionGap).toBe(8);
      expect(result.settings.itemGap).toBe(4);
    }
  });

  it("compresses gaps only (keeps font) when gap compression alone fits", async () => {
    // 高度只随 sectionGap 变化：scale=1(sg=16)→1300 溢出；间距压到 floor 前就能塞下。
    // sg 走的是上半段[knee,1]，此区间字号恒为 current，所以最优解应保持字号不变。
    const measure = async (s: StyleSettings) => {
      const ratio = (s.sectionGap - 8) / (16 - 8); // 0..1 over the gap band
      return 1000 + ratio * 300; // 1000..1300（A4=1123 落在中间）
    };
    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("optimized");
    if (result.status === "optimized") {
      const h = await measure(result.settings);
      expect(h).toBeLessThanOrEqual(A4_HEIGHT_PX);
      // 字号没被动（只压了间距）
      expect(result.settings.fontSize).toBe(current.fontSize);
      expect(result.settings.sectionGap).toBeLessThan(current.sectionGap);
      expect(result.settings.sectionGap).toBeGreaterThanOrEqual(8);
    }
  });

  it("engages font compression when gap compression alone cannot fit", async () => {
    // 即便间距压到 floor（scale=0.5）仍 1200>1123，必须靠压字号才塞下。
    const measure = async (s: StyleSettings) => {
      return 1200 - (current.fontSize - s.fontSize) * 120;
    };
    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("optimized");
    if (result.status === "optimized") {
      const h = await measure(result.settings);
      expect(h).toBeLessThanOrEqual(A4_HEIGHT_PX);
      expect(result.settings.fontSize).toBeLessThan(current.fontSize);
      expect(result.settings.fontSize).toBeGreaterThanOrEqual(11);
    }
  });

  it("binary search converges close to the optimal gap scale", async () => {
    // 在间距带内精确命中 scale=0.75（用 sectionGap 作代理）。
    const measure = async (s: StyleSettings) => {
      const gapScale = (s.sectionGap - 8) / (16 - 8); // 0..1 maps scale [0.5,1]
      // 当 gapScale=0.5（即 scale=0.75）时高度刚好 = A4
      return A4_HEIGHT_PX + (gapScale - 0.5) * 400;
    };
    const result = await findOptimalSettings(current, measure);
    expect(result.status).toBe("optimized");
    if (result.status === "optimized") {
      const foundGapScale = (result.settings.sectionGap - 8) / (16 - 8);
      expect(foundGapScale).toBeCloseTo(0.5, 1);
    }
  });
});
