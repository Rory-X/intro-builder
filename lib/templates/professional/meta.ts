import { DENSITY_PRESETS } from "@/lib/style-presets";

export const professionalMeta = {
  id: "professional" as const,
  name: "专业",
  description: "单栏清晰，适合中文互联网求职",
  isRecommended: true,
  defaultStyleSettings: { ...DENSITY_PRESETS.standard.settings },
  category: "tech" as const,
  features: [
    "单栏布局清晰，重点突出工作经历与项目",
    "适合中文互联网求职（字节 / 阿里 / 美团 / 腾讯）",
    "字号字体可调，ATS 友好排版兼容投递系统",
  ] as [string, string, string],
  tags: ["通用", "ATS 友好"],
};
