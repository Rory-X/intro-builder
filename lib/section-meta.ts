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
  label: string;
  color: string;
};

export const SECTION_META: Record<string, SectionMeta> = {
  experience: { icon: Briefcase, label: "工作经历", color: "text-blue-500" },
  education: { icon: GraduationCap, label: "教育背景", color: "text-green-500" },
  projects: { icon: FolderGit2, label: "项目经历", color: "text-purple-500" },
  skills: { icon: Wrench, label: "技能", color: "text-orange-500" },
  summary: { icon: User, label: "个人总结", color: "text-cyan-500" },
  awards: { icon: Award, label: "荣誉奖项", color: "text-yellow-500" },
  research: { icon: FlaskConical, label: "研究经历", color: "text-teal-500" },
  portfolio: { icon: Palette, label: "作品集", color: "text-pink-500" },
  custom: { icon: LayoutList, label: "自定义", color: "text-gray-500" },
};

/** Get meta for a section key, falling back to custom style for unknown keys */
export function getSectionMeta(key: string): SectionMeta {
  return SECTION_META[key] ?? SECTION_META.custom;
}
