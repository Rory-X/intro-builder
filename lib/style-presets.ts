import { DEFAULT_STYLE_SETTINGS, type StyleSettings } from "@/lib/resume-schema";

export type DensityPresetId = "compact" | "standard" | "relaxed";

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
      pagePadding: 28,
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
      pagePadding: 48,
    },
  },
};
