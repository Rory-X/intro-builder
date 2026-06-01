import type { StyleSettings } from "@/lib/resume-schema";

// Modern 是双栏布局，需要更紧凑的排版才不会撑爆侧栏 —— 字号小一档、
// 行距收紧、边距小一圈。和 standard 比省 12-18% 垂直空间。
const MODERN_DEFAULT_STYLE_SETTINGS: StyleSettings = {
  fontFamily: "sans",
  fontSize: 12,
  lineHeight: 1.5,
  bodyLineHeight: 1.5,
  headingGap: 6,
  pagePadding: 32,
  sectionGap: 14,
  itemGap: 10, photoScale: 1,
};

export const modernMeta = {
  id: "modern" as const,
  name: "现代",
  description: "技术风双栏",
  defaultStyleSettings: MODERN_DEFAULT_STYLE_SETTINGS,
  category: "tech" as const,
  features: [
    "双栏布局，深色 sidebar 突出技能与联系方式",
    "适合技术岗、设计岗，信息密度大",
    "紧凑排版适合内容丰富的简历",
  ] as [string, string, string],
  tags: ["双栏", "头像"],
};
