import { DENSITY_PRESETS } from "@/lib/style-presets";

export const classicMeta = {
  id: "classic" as const,
  name: "经典",
  description: "大厂保守，黑白单栏",
  defaultStyleSettings: {
    ...DENSITY_PRESETS.standard.settings,
    fontFamily: "serif" as const,
  },
  category: "business" as const,
  features: [
    "黑白单栏，传统稳重不张扬",
    "适合金融 / 咨询 / 律所 / 银行 / 国企等保守行业",
    "衬线字体兼容打印与正式投递",
  ] as [string, string, string],
  tags: ["衬线", "传统"],
};
