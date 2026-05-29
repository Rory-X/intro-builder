import type { ResumeContent } from "@/lib/resume-schema";
import type { TipTapJSON } from "@/lib/tiptap-types";
import { emptyDoc } from "@/lib/tiptap-types";
import { getSectionMeta } from "@/lib/section-meta";

/**
 * Slot binding 解析层。SlotRenderer 看到 `<slot data-bind="...">` 时调
 * 这个文件查表把 binding 名解析成实际值（对 value slot）或 iterable
 * 数组（对 loop slot）。
 *
 * 设计原则——为什么 binding 名是「通用语义名」而不是「ResumeContent 字段直名」：
 * Skill 写 HTML 时不知道用户简历最终长什么样。如果 binding 是
 * `experience.items[i].company` 这种字段直名，每种 section 要写一份模板。
 * 用通用名 `item.title` / `item.subtitle` / `item.dateRange` / `item.bullets`，
 * 一份 item template 适用所有 section（experience 的 company 映射到 item.title，
 * education 的 school 也映射到 item.title）。adapter pattern。
 *
 * 见 spec §4.3 + §4.3.2。spec 里的派生表跟实际 ResumeContent 形态有偏差
 * （spec 写 `content[id].items` 实际是 `content[id]` 直接是数组），
 * 这个文件以**实证 schema** 为准；spec 后续 sync。
 */

export type IterationContext = {
  /** sectionOrder loop 内可用——当前迭代到的 section 的 metadata */
  section?: {
    id: string;
    title: string;
    icon: string;
    /** 区分 basics summary / preset / custom 三种渲染分支 */
    kind: "basics" | "preset" | "custom";
  };
  /** section.items loop 内可用——通用化后的 item */
  item?: ItemView;
};

/**
 * 通用化后的 item 形态。每种 section（experience/education/projects/skills/...）
 * 通过 deriveItems 派生器映射到这个形态，Skill 写的 HTML 一份 item template
 * 适用所有 section。
 */
export type ItemView = {
  /** 主标题——experience.company / education.school / projects.name / skills.category */
  title: string;
  /** 副标题——experience.title / education.degree+major+gpa / projects.role / skills.items */
  subtitle: string;
  /** 日期区间，例如 "2022.07 – 至今"。可空字符串 */
  dateRange: string;
  /** 地点 */
  location: string;
  /** 富文本正文（TipTap doc）。skill / summary 没有富文本时为空 doc */
  bullets: TipTapJSON;
  /** 标签数组——projects.stack。其他 section 为空数组 */
  tags: string[];
  /** 链接 URL——projects.link。其他 section 为空字符串 */
  link: string;
};

// ─── Basics value slot ────────────────────────────────────────────

export const BASICS_BINDINGS = {
  "basics.name": (c: ResumeContent) => c.basics.name,
  "basics.title": (c: ResumeContent) => c.basics.title,
  "basics.email": (c: ResumeContent) => c.basics.email,
  "basics.phone": (c: ResumeContent) => c.basics.phone,
  "basics.location": (c: ResumeContent) => c.basics.location,
  "basics.website": (c: ResumeContent) => c.basics.website,
  "basics.photo": (c: ResumeContent) => c.basics.photo,
  "basics.status": (c: ResumeContent) => c.basics.status,
  "basics.summary": (c: ResumeContent) => c.basics.summary,
} as const;

export type BasicsBinding = keyof typeof BASICS_BINDINGS;

// ─── Section value slot (inside sectionOrder loop) ────────────────

export const SECTION_BINDINGS = {
  "section.id": (ctx: IterationContext) => ctx.section?.id ?? "",
  "section.title": (ctx: IterationContext) => ctx.section?.title ?? "",
  "section.icon": (ctx: IterationContext) => ctx.section?.icon ?? "",
} as const;

export type SectionBinding = keyof typeof SECTION_BINDINGS;

// ─── Item value slot (inside section.items loop) ──────────────────

export const ITEM_BINDINGS = {
  "item.title": (ctx: IterationContext) => ctx.item?.title ?? "",
  "item.subtitle": (ctx: IterationContext) => ctx.item?.subtitle ?? "",
  "item.dateRange": (ctx: IterationContext) => ctx.item?.dateRange ?? "",
  "item.location": (ctx: IterationContext) => ctx.item?.location ?? "",
  "item.bullets": (ctx: IterationContext) => ctx.item?.bullets ?? emptyDoc(),
  "item.tags": (ctx: IterationContext) => ctx.item?.tags ?? [],
  "item.link": (ctx: IterationContext) => ctx.item?.link ?? "",
} as const;

export type ItemBinding = keyof typeof ITEM_BINDINGS;

// ─── Loop slots ───────────────────────────────────────────────────

export const LOOP_BINDINGS = ["sectionOrder", "section.items"] as const;
export type LoopBinding = (typeof LOOP_BINDINGS)[number];

// ─── All bindings union ───────────────────────────────────────────

export type SlotBinding = BasicsBinding | SectionBinding | ItemBinding | LoopBinding;

export function isValidBinding(name: string): name is SlotBinding {
  return (
    name in BASICS_BINDINGS ||
    name in SECTION_BINDINGS ||
    name in ITEM_BINDINGS ||
    (LOOP_BINDINGS as readonly string[]).includes(name)
  );
}

export function isLoopBinding(name: string): name is LoopBinding {
  return (LOOP_BINDINGS as readonly string[]).includes(name);
}

// ─── Section metadata resolution ──────────────────────────────────

/**
 * Resolve a sectionOrder entry to display metadata. Returns null if the
 * section has no content to render (so SlotRenderer can skip iteration).
 *
 * - `basics` → renders only if basics.summary is non-empty
 * - preset (experience/education/projects/skills/awards/research/portfolio) → renders if array has items
 * - custom (id matches content.custom[].id) → renders if content has items
 * - unknown → null (skipped)
 */
export function resolveSection(
  sectionId: string,
  content: ResumeContent,
  sectionIcons: Record<string, string>,
): IterationContext["section"] | null {
  // basics: summary may be empty
  if (sectionId === "basics") {
    if (!content.basics.summary) return null;
    return {
      id: "basics",
      title: getSectionMeta("basics").label,
      icon: sectionIcons.basics ?? "User",
      kind: "basics",
    };
  }

  // preset section keys (experience / education / projects / skills / awards / ...)
  if (isPresetSection(sectionId)) {
    const items = derivePresetItems(sectionId, content);
    if (items.length === 0) return null;
    const meta = getSectionMeta(sectionId);
    return {
      id: sectionId,
      title: meta.label,
      icon: sectionIcons[sectionId] ?? PRESET_DEFAULT_ICONS[sectionId] ?? "Tag",
      kind: "preset",
    };
  }

  // custom section
  const custom = content.custom?.find((cs) => cs.id === sectionId);
  if (custom) {
    const hasContent = (custom.content?.content?.length ?? 0) > 0;
    if (!hasContent) return null;
    return {
      id: custom.id,
      title: custom.title,
      icon: sectionIcons[custom.id] ?? "Tag",
      kind: "custom",
    };
  }

  return null;
}

function isPresetSection(id: string): boolean {
  // 只列实际有 derivePresetItems 实现的 builtIn section（experience /
  // education / projects / skills）—— awards / research / portfolio /
  // activities / summary 这些非 builtIn preset 的数据在 ResumeContent.custom
  // 数组里（见 module-manager.tsx addSection 的 "if !BUILTIN_SECTION_KEYS.has"
  // 分支），所以走 resolveSection 的 custom 分支查 content.custom.find，而
  // 不是 preset 分支。之前误把这些 ID 列入 preset，导致 derivePresetItems
  // 走 default 返回 [] → resolveSection 返回 null → v2 模板里这些 section
  // 不渲染。
  return [
    "experience",
    "education",
    "projects",
    "skills",
  ].includes(id);
}

/**
 * Default lucide icon names per preset section. Used as fallback when the
 * template's sectionIcons map doesn't override. Names must exist in the
 * lucide whitelist (see template-studio-skill/SKILL.md).
 */
const PRESET_DEFAULT_ICONS: Record<string, string> = {
  experience: "Briefcase",
  education: "GraduationCap",
  projects: "FolderKanban",
  skills: "Sparkles",
  awards: "Award",
  research: "FlaskConical",
  portfolio: "Image",
  activities: "Users",
  summary: "User",
};

// ─── Items derivation ─────────────────────────────────────────────

/**
 * Derive ItemView[] for a given section.id. Skill 写的 HTML 用通用
 * `item.title / subtitle / dateRange / bullets / tags / link` 字段，
 * 这里把每种 section 的实际字段映射进去。
 *
 * 见 spec §4.3.2（spec 派生表写错了字段路径，这里以实际 ResumeContent 为准）。
 */
export function deriveItems(
  ctx: IterationContext,
  content: ResumeContent,
): ItemView[] {
  if (!ctx.section) return [];
  const id = ctx.section.id;

  if (id === "basics") {
    // 单元素 item，bullets 是 basics.summary 包装成 TipTap paragraph
    return [
      {
        title: "",
        subtitle: "",
        dateRange: "",
        location: "",
        bullets: textToTipTap(content.basics.summary),
        tags: [],
        link: "",
      },
    ];
  }

  if (ctx.section.kind === "custom") {
    const custom = content.custom?.find((cs) => cs.id === id);
    if (!custom) return [];
    return [
      {
        // entry-title 留空 —— section title 已经是 custom.title（"荣誉奖项"
        // / "研究经历" 等），entry header 再重复一遍视觉冗余。v2 模板的 item
        // 模板里 entry-title slot 渲染空字符串，CSS 自然不占空间。
        title: "",
        subtitle: "",
        dateRange: "",
        location: "",
        bullets: custom.content,
        tags: [],
        link: "",
      },
    ];
  }

  return derivePresetItems(id, content);
}

function derivePresetItems(sectionId: string, content: ResumeContent): ItemView[] {
  switch (sectionId) {
    case "experience":
      return content.experience.map((e) => ({
        title: e.company,
        subtitle: e.title,
        dateRange: formatDateRange(e.start, e.end),
        location: e.location,
        bullets: e.content,
        tags: [],
        link: "",
      }));

    case "education":
      return content.education.map((e) => ({
        title: e.school,
        subtitle: [e.degree, e.major, e.gpa ? `GPA ${e.gpa}` : ""]
          .filter(Boolean)
          .join(" · "),
        dateRange: formatDateRange(e.start, e.end),
        location: e.location,
        bullets: e.highlights,
        tags: [],
        link: "",
      }));

    case "projects":
      return content.projects.map((p) => ({
        title: p.name,
        subtitle: p.role,
        dateRange: formatDateRange(p.start, p.end),
        location: p.location,
        bullets: p.content,
        tags: p.stack,
        link: p.link,
      }));

    case "skills":
      return content.skills.map((g) => ({
        title: g.category,
        subtitle: g.items.join("、"),
        dateRange: "",
        location: "",
        bullets: emptyDoc(),
        tags: g.items,
        link: "",
      }));

    default:
      return [];
  }
}

function formatDateRange(start: string, end: string): string {
  if (!start && !end) return "";
  return `${start}${start && end ? " – " : ""}${end}`;
}

/** Wrap a plain string into a single-paragraph TipTap doc for RichText rendering. */
function textToTipTap(text: string): TipTapJSON {
  if (!text) return emptyDoc();
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  } as TipTapJSON;
}
