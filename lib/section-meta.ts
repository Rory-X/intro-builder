import {
  Briefcase,
  GraduationCap,
  FolderGit2,
  Wrench,
  LayoutList,
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
  custom: { icon: LayoutList, label: "自定义", color: "text-gray-500" },
};
