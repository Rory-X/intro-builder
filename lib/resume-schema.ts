import { z } from "zod";
import { TipTapJSON, emptyDoc } from "./tiptap-types";

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

/**
 * 将旧格式 SkillGroup[] 迁移为 TipTapJSON 富文本。
 * 每个 group 转为一个段落：`<strong>分类名：</strong>项目1、项目2`
 */
function migrateSkills(input: unknown): unknown {
  if (!Array.isArray(input)) return input; // 已是新格式（TipTapJSON 对象）
  const groups = input as Array<{ category?: string; items?: string[] }>;
  if (groups.length === 0) return emptyDoc();
  const content = groups.map((g) => ({
    type: "paragraph" as const,
    content: [
      ...(g.category ? [
        { type: "text" as const, marks: [{ type: "bold" as const }], text: `${g.category}：` },
      ] : []),
      { type: "text" as const, text: (g.items ?? []).join("、") },
    ].filter((node) => node.text), // 过滤空文本节点
  }));
  return { type: "doc", content };
}

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

// preprocess fires before defaults — required so a legacy row that has
// `lineHeight: 1.8` but no bodyLineHeight can backfill the new field.
// Without this, Zod fills it with default 1.6 and the user's adjusted
// line-height silently disappears on first edit.
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
    // Deprecated: kept so legacy DB rows still parse and so the preprocess
    // above can read it; new code reads bodyLineHeight (段内行高) and
    // headingGap (标题与正文间距) instead.
    lineHeight: z.number().min(1.05).max(2.0).default(1.6),
    bodyLineHeight: z.number().min(1.05).max(2.0).default(1.6),
    // 标题与下方正文之间的间距 (px) — applied as margin-bottom on h1..h4.
    headingGap: z.number().min(0).max(32).default(8),
    pagePadding: z.number().min(8).max(60).default(40),
    sectionGap: z.number().min(4).max(24).default(16),
    itemGap: z.number().min(2).max(16).default(12),
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
};

export const ResumeContent = z.object({
  basics: Basics,
  education: z.array(Education).default([]),
  experience: z.array(Experience).default([]),
  projects: z.array(Project).default([]),
  skills: z.preprocess(migrateSkills, TipTapJSON).default(() => emptyDoc()),
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
    name: "你的姓名",
    status: "",
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
  skills: emptyDoc(),
  custom: [],
  sectionOrder: [...DEFAULT_SECTION_ORDER],
});
