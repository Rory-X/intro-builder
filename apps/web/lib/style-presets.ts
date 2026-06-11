import { DEFAULT_STYLE_SETTINGS, type StyleSettings } from "@intro-builder/shared/schemas";

export type DensityPresetId = "compact" | "standard" | "relaxed";
export type LineHeightPresetId = "compact" | "standard" | "relaxed";
export type PagePaddingPresetId = "narrow" | "standard" | "wide";

export const DENSITY_PRESETS: Record<
  DensityPresetId,
  { label: string; description: string; settings: StyleSettings }
> = {
  compact: {
    label: "紧凑",
    description: "内容多、一页简历",
    settings: {
      fontFamily: "sans",
      fontSize: 11,
      lineHeight: 1.35,
      bodyLineHeight: 1.35,
      headingGap: 4,
      pagePadding: 28,
      sectionGap: 10,
      itemGap: 8, photoScale: 1,
    },
  },
  standard: {
    label: "标准",
    description: "推荐默认间距",
    settings: { ...DEFAULT_STYLE_SETTINGS },
  },
  relaxed: {
    label: "舒展",
    description: "内容较少、留白更多",
    settings: {
      fontFamily: "sans",
      fontSize: 14,
      lineHeight: 1.75,
      bodyLineHeight: 1.75,
      headingGap: 14,
      pagePadding: 48,
      sectionGap: 20,
      itemGap: 14, photoScale: 1,
    },
  },
};

export const LINE_HEIGHT_PRESETS: Record<
  LineHeightPresetId,
  { label: string; value: StyleSettings["lineHeight"] }
> = {
  compact: { label: "紧凑", value: 1.35 },
  standard: { label: "标准", value: DEFAULT_STYLE_SETTINGS.lineHeight },
  relaxed: { label: "舒展", value: 1.75 },
};

export const PAGE_PADDING_PRESETS: Record<
  PagePaddingPresetId,
  { label: string; value: StyleSettings["pagePadding"] }
> = {
  narrow: { label: "窄", value: 28 },
  standard: { label: "标准", value: DEFAULT_STYLE_SETTINGS.pagePadding },
  wide: { label: "宽", value: 48 },
};
