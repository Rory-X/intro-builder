import type { ResumeContent } from "@/lib/resume-schema";
import type { TipTapJSON } from "@/lib/tiptap-types";
import { emptyDoc } from "@/lib/tiptap-types";
import { getSectionMeta } from "@/lib/section-meta";
import type { SectionIconDeclaration } from "./types";

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
  /** profile.contacts loop 内可用——当前联系方式 */
  contact?: ContactView;
  /** sectionOrder loop 内可用——当前迭代到的 section 的 metadata */
  section?: {
    id: string;
    title: string;
    icon: string;
    iconColor?: string;
    /** 通用内容形态：block = 一段富文本，list = 多个条目 */
    kind: "block" | "list";
    /** 数据来源，用于 adapter 内部取值；模板通常不需要关心 */
    source: "basics" | "preset" | "custom";
  };
  /** section.items loop 内可用——通用化后的 item */
  item?: ItemView;
};

export type ContactView = {
  type: "email" | "phone" | "location" | "website";
  icon: string;
  label: string;
  href: string;
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
  /** 辅助信息行——location / tags / other compact metadata */
  meta: string;
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
  "basics.status": (c: ResumeContent) => c.basics.status,
  "basics.summary": (c: ResumeContent) => c.basics.summary,
} as const;

export type BasicsBinding = keyof typeof BASICS_BINDINGS;

// ─── Icon slots (basics.icon.*) ──────────────────────────────────
// 为联系信息提供 icon 支持，例如 <slot data-bind="basics.icon.Mail">
// 渲染为对应的 lucide 图标。兼容批量生成模板的写法。
export const ICON_BINDINGS: Record<string, string> = {
  "basics.icon.Mail": "Mail",
  "basics.icon.Phone": "Phone",
  "basics.icon.MapPin": "MapPin",
  "basics.icon.Globe": "Globe",
  "basics.icon.Clock": "Clock",
} as const;

// ─── Profile value slots ─────────────────────────────────────────

export const PROFILE_BINDINGS = {
  "profile.name": (c: ResumeContent) => c.basics.name,
  "profile.title": (c: ResumeContent) => c.basics.title,
  "profile.email": (c: ResumeContent) => c.basics.email,
  "profile.phone": (c: ResumeContent) => c.basics.phone,
  "profile.location": (c: ResumeContent) => c.basics.location,
  "profile.website": (c: ResumeContent) => c.basics.website,
  "profile.status": (c: ResumeContent) => c.basics.status,
  "profile.summary": (c: ResumeContent) => c.basics.summary,
} as const;

export type ProfileBinding = keyof typeof PROFILE_BINDINGS;

// ─── Image binding (<img data-bind="...">) ────────────────────────
// 图片类 binding 走 SlotRenderer 的 <img> 路径而非 <slot>：引擎把 URL 注入
// img 的 src，空值则整个 img 不渲染。photo 故意不放进 BASICS_BINDINGS（文本
// 路径）—— 否则 <slot data-bind="basics.photo"> 会把一长串 URL 当文字渲染出
// 来（footgun）。集合形式预留未来扩展（如 logo、二维码）。
export const IMAGE_BINDINGS = {
  "basics.photo": (c: ResumeContent) => c.basics.photo,
  "profile.photo": (c: ResumeContent) => c.basics.photo,
} as const;

export type ImageBinding = keyof typeof IMAGE_BINDINGS;

export function isImageBinding(name: string): name is ImageBinding {
  return name in IMAGE_BINDINGS;
}

// ─── Section value slot (inside sectionOrder loop) ────────────────

export const SECTION_BINDINGS = {
  "section.id": (ctx: IterationContext) => ctx.section?.id ?? "",
  "section.title": (ctx: IterationContext) => ctx.section?.title ?? "",
  "section.icon": (ctx: IterationContext) => ctx.section?.icon ?? "",
  "section.kind": (ctx: IterationContext) => ctx.section?.kind ?? "",
  "section.body": (ctx: IterationContext, content: ResumeContent) =>
    ctx.section ? deriveSectionBody(ctx.section, content) : emptyDoc(),
} as const;

export type SectionBinding = keyof typeof SECTION_BINDINGS;

// ─── Item value slot (inside section.items loop) ──────────────────

export const ITEM_BINDINGS = {
  "item.title": (ctx: IterationContext) => ctx.item?.title ?? "",
  "item.subtitle": (ctx: IterationContext) => ctx.item?.subtitle ?? "",
  "item.meta": (ctx: IterationContext) => ctx.item?.meta ?? "",
  "item.dateRange": (ctx: IterationContext) => ctx.item?.dateRange ?? "",
  "item.location": (ctx: IterationContext) => ctx.item?.location ?? "",
  "item.bullets": (ctx: IterationContext) => ctx.item?.bullets ?? emptyDoc(),
  "item.tags": (ctx: IterationContext) => ctx.item?.tags ?? [],
  "item.link": (ctx: IterationContext) => ctx.item?.link ?? "",
} as const;

export type ItemBinding = keyof typeof ITEM_BINDINGS;

// ─── Contact value slot (inside profile.contacts loop) ───────────

export const CONTACT_BINDINGS = {
  "contact.type": (ctx: IterationContext) => ctx.contact?.type ?? "",
  "contact.icon": (ctx: IterationContext) => ctx.contact?.icon ?? "",
  "contact.label": (ctx: IterationContext) => ctx.contact?.label ?? "",
  "contact.href": (ctx: IterationContext) => ctx.contact?.href ?? "",
} as const;

export type ContactBinding = keyof typeof CONTACT_BINDINGS;

// ─── Loop slots ───────────────────────────────────────────────────

export const LOOP_BINDINGS = ["profile.contacts", "sectionOrder", "section.items"] as const;
export type LoopBinding = (typeof LOOP_BINDINGS)[number];

// ─── All bindings union ───────────────────────────────────────────

export type SlotBinding =
  | BasicsBinding
  | ProfileBinding
  | ImageBinding
  | SectionBinding
  | ItemBinding
  | ContactBinding
  | LoopBinding;

export function isValidBinding(name: string): name is SlotBinding {
  return (
    name in BASICS_BINDINGS ||
    name in PROFILE_BINDINGS ||
    name in ICON_BINDINGS ||
    name in IMAGE_BINDINGS ||
    name in SECTION_BINDINGS ||
    name in ITEM_BINDINGS ||
    name in CONTACT_BINDINGS ||
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
  sectionIcons: Record<string, SectionIconDeclaration>,
): IterationContext["section"] | null {
  const decl = sectionIcons[sectionId];
  // basics: summary may be empty
  if (sectionId === "basics") {
    if (!content.basics.summary) return null;
    return {
      id: "basics",
      title: "自我介绍",
      icon: decl?.icon ?? getSectionMeta("basics").iconName,
      iconColor: decl?.color,
      kind: "block",
      source: "basics",
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
      icon: decl?.icon ?? meta.iconName,
      iconColor: decl?.color,
      kind: sectionId === "skills" ? "block" : "list",
      source: "preset",
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
      icon: decl?.icon ?? getSectionMeta(custom.id).iconName,
      iconColor: decl?.color,
      kind: "block",
      source: "custom",
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
    "research",
    "skills",
  ].includes(id);
}

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
        meta: "",
        dateRange: "",
        location: "",
        bullets: textToTipTap(content.basics.summary),
        tags: [],
        link: "",
      },
    ];
  }

  if (ctx.section.source === "custom") {
    const custom = content.custom?.find((cs) => cs.id === id);
    if (!custom) return [];
    return [
      {
        // entry-title 留空 —— section title 已经是 custom.title（"荣誉奖项"
        // / "研究经历" 等），entry header 再重复一遍视觉冗余。v2 模板的 item
        // 模板里 entry-title slot 渲染空字符串，CSS 自然不占空间。
        title: "",
        subtitle: "",
        meta: "",
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

export function deriveContacts(content: ResumeContent): ContactView[] {
  const { basics } = content;
  const contacts: Array<ContactView | null> = [
    basics.phone
      ? { type: "phone", icon: "Phone", label: basics.phone, href: `tel:${basics.phone}` }
      : null,
    basics.email
      ? { type: "email", icon: "Mail", label: basics.email, href: `mailto:${basics.email}` }
      : null,
    basics.website
      ? {
          type: "website",
          icon: "Monitor",
          label: basics.website,
          href: /^https?:\/\//i.test(basics.website) ? basics.website : `https://${basics.website}`,
        }
      : null,
  ];
  return contacts.filter((item): item is ContactView => item !== null);
}

function deriveSectionBody(
  section: NonNullable<IterationContext["section"]>,
  content: ResumeContent,
): TipTapJSON {
  if (section.id === "basics") return textToTipTap(content.basics.summary);
  if (section.id === "skills") return content.skills ?? emptyDoc();
  if (section.source === "custom") {
    return content.custom?.find((cs) => cs.id === section.id)?.content ?? emptyDoc();
  }
  return emptyDoc();
}

function derivePresetItems(sectionId: string, content: ResumeContent): ItemView[] {
  switch (sectionId) {
    case "experience":
      return content.experience.map((e) => ({
        title: e.company,
        subtitle: e.title,
        meta: "",
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
        meta: "",
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
        meta: p.stack.length > 0 ? p.stack.join(" · ") : "",
        dateRange: formatDateRange(p.start, p.end),
        location: p.location,
        bullets: p.content,
        tags: p.stack,
        link: p.link,
      }));

    case "research":
      return (content.research ?? []).map((r) => ({
        title: r.name,
        subtitle: r.role,
        meta: "",
        dateRange: formatDateRange(r.start, r.end),
        location: "",
        bullets: r.content,
        tags: [],
        link: r.link ?? "",
      }));

    case "skills":
      if (!content.skills?.content?.length) return [];
      return [{
        title: "",
        subtitle: "",
        meta: "",
        dateRange: "",
        location: "",
        bullets: content.skills,
        tags: [],
        link: "",
      }];

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
