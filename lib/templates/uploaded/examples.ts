/**
 * Schema examples for both frame kinds. Compiled by TypeScript so any
 * mismatch with `LayoutConfig` errors at build time — useful as a
 * lightweight self-check while we lock down the schema.
 *
 * These are reference shapes only — not consumed at runtime. The Skill
 * produces real values; the renderer reads from DB rows.
 */
import type { LayoutConfig } from "./types";

/**
 * 纵向单栏示例（vertical frame）
 *
 * 真实场景：陈媛媛 Abbey 简历——单栏从上到下，header / 个人总结 /
 * 工作经历 / 项目经历 / 社团组织 / 荣誉 / 其他 顺序排列，无 sidebar。
 */
export const VERTICAL_EXAMPLE: LayoutConfig = {
  frame: { kind: "vertical" },
  headerVariant: "professional",
  sectionTitleVariant: "professional",
  itemHeaderVariant: "professional",
  theme: {
    primaryColor: "#3B8BCD",
  },
  sectionIcons: {
    summary: { icon: "User" },
    experience: { icon: "Briefcase" },
    projects: { icon: "FolderKanban" },
    education: { icon: "GraduationCap" },
    skills: { icon: "Sparkles" },
    awards: { icon: "Award" },
    activities: { icon: "Users" },
    other: { icon: "Tag" },
  },
};

/**
 * 横向双栏示例（horizontal frame）
 *
 * 真实场景：modern 内置模板风格——左侧 240px 深色 sidebar 放头像 +
 * 教育 + 技能；右侧 main 放经历 + 项目。
 */
export const HORIZONTAL_EXAMPLE: LayoutConfig = {
  frame: {
    kind: "horizontal",
    sidebar: {
      side: "left",
      width: "240px",
      sections: ["education", "skills"],
      bgColor: "#1F2937",
      textColor: "#F9FAFB",
    },
  },
  headerVariant: "modern-sidebar",
  sectionTitleVariant: "modern",
  itemHeaderVariant: "modern",
  theme: {
    primaryColor: "#10B981",
  },
  sectionIcons: {
    education: { icon: "GraduationCap" },
    skills: { icon: "Sparkles" },
    experience: { icon: "Briefcase" },
    projects: { icon: "FolderKanban" },
  },
};
