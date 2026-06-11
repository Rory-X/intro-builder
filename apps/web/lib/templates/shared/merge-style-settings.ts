import { DEFAULT_STYLE_SETTINGS, type StyleSettings } from "@intro-builder/shared/schemas";

export function mergeStyleSettings(styleSettings?: StyleSettings): StyleSettings {
  return { ...DEFAULT_STYLE_SETTINGS, ...styleSettings };
}
