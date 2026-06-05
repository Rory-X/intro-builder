/**
 * Smart layout algorithm — finds optimal typography settings to fit
 * resume content on a single A4 page using binary search.
 *
 * Pure algorithm module: no DOM or React dependencies.
 */

import type { StyleSettings } from "@/lib/resume-schema";
import { A4_HEIGHT_PX } from "@/lib/pagination";

export { A4_HEIGHT_PX };

// 美观下限：智能排版压到这里就停，不再为塞进一页牺牲可读性（zoo 确认的 floor）。
// 这些不是"能塞下就行"的生存下限，而是"压到这里仍好看"的审美下限——之前的
// 1.05 行距 / 0 标题间距是挤成一团的丑态，抬高后压缩永远落在好看的区间里。
// pagePadding 不参与压缩——页边距是品牌/视觉决策（zoo 反馈：智能排版不能影响
// 页边距）。fontSize 作为最后兜底分级下降到 MIN_FONT，但只影响正文；个人信息
// 栏字号独立保护（通过 --profile-font-size CSS 变量，在 measure 时锁定原值）。
const MIN_FONT = 11;
const MIN_LINE_HEIGHT = 1.25;
const MIN_SECTION_GAP = 8;
const MIN_ITEM_GAP = 4;
const MIN_HEADING_GAP = 4;

// fontSize 压缩策略：scale 低于 FONT_KNEE 才开始压字号。阈值以上只压间距/行距。
// 个人信息栏字号独立保护：渲染器注入 --profile-font-size 锁定原值，header 区域
// 通过 [data-pagination-header] 选择器强制使用该变量，不受 --font-size 压缩影响。
const FONT_KNEE = 0.5;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export type SmartLayoutResult =
  | { status: "already-fits" }
  | { status: "optimized"; settings: StyleSettings }
  | { status: "cannot-fit"; settings: StyleSettings };

/**
 * 把 scale[0,1] 映射成一套压缩后的排版设置。scale=1 → current（不压）；
 * scale=0 → 全部触底（间距/行距到 floor + 字号到 floor）。
 *
 * 分两段（FONT_KNEE）：
 * - scale ∈ [FONT_KNEE, 1]：只压间距/行距（gapScale 0→1），字号保持 current。
 * - scale ∈ [0, FONT_KNEE]：间距/行距已触底，改为分级压字号（fontScale 0→1）。
 *
 * floor 一律取 min(MIN_*, current)：用户若已把某项设得比 floor 还低，压缩绝不
 * 反向把它放大回 floor。fontFamily / pagePadding / photoScale 始终保持 current。
 */
export function interpolateSettings(
  current: StyleSettings,
  scale: number,
): StyleSettings {
  const gapScale = clamp01((scale - FONT_KNEE) / (1 - FONT_KNEE));
  const fontScale = clamp01(scale / FONT_KNEE);

  const fontFloor = Math.min(MIN_FONT, current.fontSize);
  const lhFloor = Math.min(MIN_LINE_HEIGHT, current.bodyLineHeight);
  const sgFloor = Math.min(MIN_SECTION_GAP, current.sectionGap);
  const igFloor = Math.min(MIN_ITEM_GAP, current.itemGap);
  const hgFloor = Math.min(MIN_HEADING_GAP, current.headingGap);

  const bodyLh =
    Math.round((lhFloor + (current.bodyLineHeight - lhFloor) * gapScale) * 100) / 100;

  return {
    fontFamily: current.fontFamily,
    fontSize: Math.round((fontFloor + (current.fontSize - fontFloor) * fontScale) * 2) / 2,
    lineHeight: bodyLh,
    headingGap: Math.round(hgFloor + (current.headingGap - hgFloor) * gapScale),
    bodyLineHeight: bodyLh,
    pagePadding: current.pagePadding,
    sectionGap: Math.round(sgFloor + (current.sectionGap - sgFloor) * gapScale),
    itemGap: Math.round(igFloor + (current.itemGap - igFloor) * gapScale),
    photoScale: current.photoScale,
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
