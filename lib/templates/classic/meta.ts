import { DENSITY_PRESETS } from "@/lib/style-presets";

export const classicMeta = {
  id: "classic" as const,
  name: "经典",
  description: "大厂保守，黑白单栏",
  defaultStyleSettings: {
    ...DENSITY_PRESETS.standard.settings,
    fontFamily: "serif" as const,
  },
  category: "simple" as const,
  tags: ["衬线", "传统"],
};
