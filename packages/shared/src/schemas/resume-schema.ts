import { z } from "zod";
import { TipTapJSON, emptyDoc } from "../types/tiptap";

export const Basics = z.object({
  name: z.string().default(""),
  status: z.string().default(""),
  title: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  location: z.string().default(""),
  website: z.string().default(""),
  summary: z.string().default(""),
  photo: z.string().optional().default(""),
});

export const Education = z.object({
  school: z.string().default(""),
  degree: z.string().default(""),
  major: z.string().default(""),
  location: z.string().default(""),
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
  role: z.string().default(""),
  location: z.string().default(""),
  start: z.string().default(""),
  end: z.string().default(""),
  stack: z.array(z.string()).default([]),
  link: z.string().optional().default(""),
  content: TipTapJSON.default(() => emptyDoc()),
});

/** @deprecated 旧格式，保留仅用于迁移兼容。新代码不应使用。 */
export const SkillGroup = z.object({
  category: z.string().default(""),
  items: z.array(z.string()).default([]),
});

function migrateSkills(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  const groups = input as Array<{ category?: string; items?: string[] }>;
  if (groups.length === 0) return emptyDoc();
  const content = groups.map((g) => ({
    type: "paragraph" as const,
    content: [
      ...(g.category ? [
        { type: "text" as const, marks: [{ type: "bold" as const }], text: `${g.category}：` },
      ] : []),
      { type: "text" as const, text: (g.items ?? []).join("、") },
    ].filter((node) => node.text),
  }));
  return { type: "doc", content };
}

export const Research = z.object({
  name: z.string().default(""),
  role: z.string().default(""),
  location: z.string().default(""),
  start: z.string().default(""),
  end: z.string().default(""),
  paperTitle: z.string().optional().default(""),
  link: z.string().optional().default(""),
  content: TipTapJSON.default(() => emptyDoc()),
});

export const CustomSection = z.object({
  id: z.string(),
  title: z.string().default(""),
  content: TipTapJSON.default(() => emptyDoc()),
});

export const DEFAULT_SECTION_ORDER = ["basics", "experience", "education", "projects", "skills"] as const;

export const MODULE_PRESETS = [
  { id: "experience", label: "实习/工作经历", builtIn: true },
  { id: "education", label: "教育经历", builtIn: true },
  { id: "projects", label: "项目经历", builtIn: true },
  { id: "research", label: "研究经历", builtIn: true },
  { id: "skills", label: "专业技能", builtIn: true },
  { id: "summary", label: "个人总结", builtIn: true },
  { id: "awards", label: "荣誉奖项", builtIn: true },
  { id: "portfolio", label: "作品集", builtIn: true },
] as const;

export const BUILTIN_SECTION_KEYS = new Set(["basics", "experience", "education", "projects", "research", "skills", "summary", "awards", "portfolio"]);

export const StyleSettings = z.preprocess(
  (raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const r: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    if (typeof r.lineHeight === "number" && r.bodyLineHeight === undefined) {
      r.bodyLineHeight = r.lineHeight;
    }
    return r;
  },
  z.object({
    fontFamily: z.enum(["sans", "serif", "mono"]).default("sans"),
    fontSize: z.number().min(8).max(16).default(13),
    lineHeight: z.number().min(1.05).max(2.0).default(1.6),
    bodyLineHeight: z.number().min(1.05).max(2.0).default(1.6),
    headingGap: z.number().min(0).max(32).default(8),
    pagePadding: z.number().min(8).max(60).default(40),
    sectionGap: z.number().min(4).max(24).default(16),
    itemGap: z.number().min(2).max(16).default(12),
    photoScale: z.number().min(0.5).max(1.5).default(1),
  }),
);

export type StyleSettings = z.infer<typeof StyleSettings>;

export const DEFAULT_STYLE_SETTINGS: StyleSettings = {
  fontFamily: "sans",
  fontSize: 13,
  lineHeight: 1.6,
  bodyLineHeight: 1.6,
  headingGap: 8,
  pagePadding: 40,
  sectionGap: 16,
  itemGap: 12,
  photoScale: 1,
};

export const ResumeContent = z.object({
  basics: Basics,
  education: z.array(Education).default([]),
  experience: z.array(Experience).default([]),
  projects: z.array(Project).default([]),
  research: z.array(Research).default([]),
  skills: z.preprocess(migrateSkills, TipTapJSON).default(() => emptyDoc()),
  summary: TipTapJSON.default(() => emptyDoc()),
  awards: TipTapJSON.default(() => emptyDoc()),
  portfolio: TipTapJSON.default(() => emptyDoc()),
  custom: z.array(CustomSection).default([]),
  sectionOrder: z.array(z.string()).default([...DEFAULT_SECTION_ORDER]),
  styleSettings: StyleSettings.optional(),
  smartLayout: z.object({
    enabled: z.boolean(),
    originalSettings: StyleSettings,
  }).optional(),
});

export type ResumeContent = z.infer<typeof ResumeContent>;

export const emptyResumeContent = (): ResumeContent => ({
  basics: {
    name: "张三",
    status: "在职",
    title: "前端工程师",
    email: "zhang@example.com",
    phone: "138 0000 0000",
    location: "北京",
    website: "github.com/zhangsan",
    summary: "",
    photo: "/templates/placeholder-avatar.png",
  },
  education: [],
  experience: [],
  projects: [],
  research: [],
  skills: emptyDoc(),
  summary: emptyDoc(),
  awards: emptyDoc(),
  portfolio: emptyDoc(),
  custom: [],
  sectionOrder: [...DEFAULT_SECTION_ORDER],
});
