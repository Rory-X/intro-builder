import {
  Briefcase,
  GraduationCap,
  FolderGit2,
  Wrench,
  LayoutList,
  User,
  Award,
  FlaskConical,
  Palette,
  type LucideIcon,
} from "lucide-react";

export type SectionMeta = {
  icon: LucideIcon;
  /** v2 渲染端的 lucide 字符串名信源，必须与 icon 组件一致且在 ICON_REGISTRY 白名单内 */
  iconName: string;
  label: string;
  color: string;
};

export const SECTION_META: Record<string, SectionMeta> = {
  experience: { icon: Briefcase, iconName: "Briefcase", label: "工作经历", color: "text-blue-500" },
  education: { icon: GraduationCap, iconName: "GraduationCap", label: "教育背景", color: "text-green-500" },
  projects: { icon: FolderGit2, iconName: "FolderGit2", label: "项目经历", color: "text-purple-500" },
  skills: { icon: Wrench, iconName: "Wrench", label: "技能", color: "text-orange-500" },
  summary: { icon: User, iconName: "User", label: "个人总结", color: "text-cyan-500" },
  awards: { icon: Award, iconName: "Award", label: "荣誉奖项", color: "text-yellow-500" },
  research: { icon: FlaskConical, iconName: "FlaskConical", label: "研究经历", color: "text-teal-500" },
  portfolio: { icon: Palette, iconName: "Palette", label: "作品集", color: "text-pink-500" },
  custom: { icon: LayoutList, iconName: "LayoutList", label: "自定义", color: "text-gray-500" },
};

/** Get meta for a section key, falling back to custom style for unknown keys */
export function getSectionMeta(key: string): SectionMeta {
  return SECTION_META[key] ?? SECTION_META.custom;
}
