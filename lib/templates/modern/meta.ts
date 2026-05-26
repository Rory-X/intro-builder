import type { StyleSettings } from "@/lib/resume-schema";

// Modern 是双栏布局，需要更紧凑的排版才不会撑爆侧栏 —— 字号小一档、
// 行距收紧、边距小一圈。和 standard 比省 12-18% 垂直空间。
const MODERN_DEFAULT_STYLE_SETTINGS: StyleSettings = {
  fontFamily: "sans",
  fontSize: 12,
  lineHeight: 1.5,
  pagePadding: 32,
};

export const modernMeta = {
  id: "modern" as const,
  name: "现代",
  description: "技术风双栏",
  defaultStyleSettings: MODERN_DEFAULT_STYLE_SETTINGS,
  category: "twocol" as const,
  tags: ["双栏", "头像"],
};
