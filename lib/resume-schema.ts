import { z } from "zod";
import { TipTapJSON, emptyDoc } from "./tiptap-types";

const nonEmpty = z.string().min(1, "必填");

export const Basics = z.object({
  name: nonEmpty,
  title: z.string().default(""),
  email: z.string().email(),
  phone: z.string().default(""),
  location: z.string().default(""),
  website: z.string().url().optional().or(z.literal("")).default(""),
  summary: z.string().default(""),
  photo: z.string().optional().default(""),
});

export const Education = z.object({
  school: z.string().default(""),
  degree: z.string().default(""),
  major: z.string().default(""),
  start: z.string().default(""),
  end: z.string().default(""),
  gpa: z.string().optional().default(""),
  highlights: TipTapJSON.default(() => emptyDoc()),
});

export const Experience = z.object({
  company: z.string().default(""),
  title: z.string().default(""),
  start: z.string().default(""),
  end: z.string().default(""),
  location: z.string().optional().default(""),
  content: TipTapJSON.default(() => emptyDoc()),
});

export const Project = z.object({
  name: z.string().default(""),
  stack: z.array(z.string()).default([]),
  link: z.string().optional().default(""),
  content: TipTapJSON.default(() => emptyDoc()),
});

export const SkillGroup = z.object({
  category: z.string().default(""),
  items: z.array(z.string()).default([]),
});

export const CustomSection = z.object({
  id: z.string(),
  title: z.string().default(""),
  content: TipTapJSON.default(() => emptyDoc()),
});

export const DEFAULT_SECTION_ORDER = ["basics", "experience", "education", "projects", "skills"] as const;

/** Preset module types available for adding */
export const MODULE_PRESETS = [
  { id: "experience", label: "实习/工作经历", builtIn: true },
  { id: "education", label: "教育经历", builtIn: true },
  { id: "projects", label: "项目经历", builtIn: true },
  { id: "skills", label: "专业技能", builtIn: true },
  { id: "summary", label: "个人总结", builtIn: false },
  { id: "awards", label: "荣誉奖项", builtIn: false },
  { id: "research", label: "研究经历", builtIn: false },
  { id: "portfolio", label: "作品集", builtIn: false },
] as const;

/** Built-in section keys (have dedicated editors) */
export const BUILTIN_SECTION_KEYS = new Set(["basics", "experience", "education", "projects", "skills"]);

export const StyleSettings = z.object({
  fontFamily: z.enum(["sans", "serif", "mono"]).default("sans"),
  fontSize: z.number().min(10).max(16).default(13),
  lineHeight: z.number().min(1.2).max(2.0).default(1.6),
  pagePadding: z.number().min(20).max(60).default(40),
});

export type StyleSettings = z.infer<typeof StyleSettings>;

export const DEFAULT_STYLE_SETTINGS: StyleSettings = {
  fontFamily: "sans",
  fontSize: 13,
  lineHeight: 1.6,
  pagePadding: 40,
};

export const ResumeContent = z.object({
  basics: Basics,
  education: z.array(Education).default([]),
  experience: z.array(Experience).default([]),
  projects: z.array(Project).default([]),
  skills: z.array(SkillGroup).default([]),
  custom: z.array(CustomSection).default([]),
  sectionOrder: z.array(z.string()).default([...DEFAULT_SECTION_ORDER]),
  styleSettings: StyleSettings.optional(),
});

export type ResumeContent = z.infer<typeof ResumeContent>;

export const emptyResumeContent = (): ResumeContent => ({
  basics: {
    name: "你的姓名",
    title: "目标岗位",
    email: "you@example.com",
    phone: "",
    location: "",
    website: "",
    summary: "",
    photo: "",
  },
  education: [],
  experience: [],
  projects: [],
  skills: [],
  custom: [],
  sectionOrder: [...DEFAULT_SECTION_ORDER],
});
