/**
 * Smart layout algorithm — finds optimal typography settings to fit
 * resume content on a single A4 page using binary search.
 *
 * Pure algorithm module: no DOM or React dependencies.
 */

import type { StyleSettings } from "@/lib/resume-schema";
import { A4_HEIGHT_PX } from "@/lib/pagination";

export { A4_HEIGHT_PX };

// Minimum values for each adjustable setting.
// pagePadding 不在算法可调维度内 —— 用户设的页边距是品牌/视觉决策，不是
// 密度调节，算法压缩时必须保留 (zoo 反馈：智能排版不能影响页边距)。
const MIN_FONT = 8;
const MIN_LINE_HEIGHT = 1.05;
const MIN_SECTION_GAP = 4;
const MIN_ITEM_GAP = 2;

export type SmartLayoutResult =
  | { status: "already-fits" }
  | { status: "optimized"; settings: StyleSettings }
  | { status: "cannot-fit"; settings: StyleSettings };

/**
 * Linear interpolation between minimum and current settings based on scale [0,1].
 *
 * scale=0 → all minimums; scale=1 → current (unchanged) settings.
 * fontFamily is always preserved from current.
 */
export function interpolateSettings(
  current: StyleSettings,
  scale: number,
): StyleSettings {
  return {
    fontFamily: current.fontFamily,
    fontSize:
      Math.round((MIN_FONT + (current.fontSize - MIN_FONT) * scale) * 10) / 10,
    lineHeight:
      Math.round(
        (MIN_LINE_HEIGHT + (current.lineHeight - MIN_LINE_HEIGHT) * scale) *
          100,
      ) / 100,
    headingLineHeight:
      Math.round(
        (MIN_LINE_HEIGHT + (current.headingLineHeight - MIN_LINE_HEIGHT) * scale) *
          100,
      ) / 100,
    bodyLineHeight:
      Math.round(
        (MIN_LINE_HEIGHT + (current.bodyLineHeight - MIN_LINE_HEIGHT) * scale) *
          100,
      ) / 100,
    // pagePadding 不参与算法压缩 —— 始终保留用户设定值。理由见 MIN_FONT
    // 上方注释：页边距是品牌/视觉决策（用户调整 slider 是想让纸边一圈留白
    // 改变），算法把它压到 MIN 时用户感知"页边距被自动改了"= bug。
    pagePadding: current.pagePadding,
    sectionGap: Math.round(
      MIN_SECTION_GAP + (current.sectionGap - MIN_SECTION_GAP) * scale,
    ),
    itemGap: Math.round(
      MIN_ITEM_GAP + (current.itemGap - MIN_ITEM_GAP) * scale,
    ),
  };
}

/**
 * Binary search for the maximum scale where measure(settings) <= A4_HEIGHT_PX.
 *
 * `measure` is an async function (e.g. DOM measurement) that returns content
 * height in pixels for a given set of style settings.
 *
 * Algorithm:
 * 1. If content already fits at current settings → "already-fits"
 * 2. If content overflows even at minimum settings → "cannot-fit"
 * 3. Binary search (8 iterations) to find the largest scale that fits
 */
export async function findOptimalSettings(
  current: StyleSettings,
  measure: (settings: StyleSettings) => Promise<number>,
): Promise<SmartLayoutResult> {
  // 1. Check if content already fits
  const currentHeight = await measure(current);
  if (currentHeight <= A4_HEIGHT_PX) {
    return { status: "already-fits" };
  }

  // 2. Check if even minimum settings cannot make it fit
  // Still return the most compact settings so user gets the best possible result
  const minSettings = interpolateSettings(current, 0);
  const minHeight = await measure(minSettings);
  if (minHeight > A4_HEIGHT_PX) {
    return { status: "cannot-fit", settings: minSettings };
  }

  // 3. Binary search for the maximum scale that fits
  let lo = 0;
  let hi = 1;

  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const h = await measure(interpolateSettings(current, mid));
    if (h <= A4_HEIGHT_PX) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return { status: "optimized", settings: interpolateSettings(current, lo) };
}
