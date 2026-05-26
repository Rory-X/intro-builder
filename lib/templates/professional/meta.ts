import { DENSITY_PRESETS } from "@/lib/style-presets";

export const professionalMeta = {
  id: "professional" as const,
  name: "专业",
  description: "单栏清晰，适合中文互联网求职",
  isRecommended: true,
  defaultStyleSettings: { ...DENSITY_PRESETS.standard.settings },
  category: "simple" as const,
  tags: ["通用", "ATS 友好"],
};
