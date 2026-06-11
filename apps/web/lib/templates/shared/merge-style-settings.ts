import { DEFAULT_STYLE_SETTINGS, type StyleSettings } from "@/lib/resume-schema";

export function mergeStyleSettings(styleSettings?: StyleSettings): StyleSettings {
  return { ...DEFAULT_STYLE_SETTINGS, ...styleSettings };
}
